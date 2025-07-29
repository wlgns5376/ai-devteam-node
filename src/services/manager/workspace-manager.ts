import { 
  WorkspaceManagerInterface,
  ManagerServiceConfig,
  WorkspaceInfo,
  GitServiceInterface,
  RepositoryManagerInterface,
  ManagerError
} from '@/types/manager.types';
import { Logger } from '../logger';
import { StateManager } from '../state-manager';
import fs from 'fs/promises';
import path from 'path';

interface WorkspaceManagerDependencies {
  readonly logger: Logger;
  readonly stateManager: StateManager;
  readonly gitService: GitServiceInterface;
  readonly repositoryManager: RepositoryManagerInterface;
}

export class WorkspaceManager implements WorkspaceManagerInterface {
  private errors: ManagerError[] = [];

  constructor(
    private readonly config: ManagerServiceConfig,
    private readonly dependencies: WorkspaceManagerDependencies
  ) {}

  async createWorkspace(taskId: string, repositoryId: string): Promise<WorkspaceInfo> {
    this.validateInputs(taskId, repositoryId);

    try {
      const workspaceDir = this.generateWorkspaceDirectory(repositoryId, taskId);
      const branchName = taskId;
      const claudeLocalPath = path.join(workspaceDir, 'CLAUDE.local.md');

      // 디렉토리 존재 확인
      const directoryExists = await this.checkDirectoryExists(workspaceDir);
      
      if (!directoryExists) {
        await fs.mkdir(workspaceDir, { recursive: true });
        this.dependencies.logger.info('Workspace directory created', { 
          taskId, 
          repositoryId, 
          workspaceDir 
        });
      } else {
        this.dependencies.logger.info('Using existing workspace directory', { 
          workspaceDir 
        });
      }

      const workspaceInfo: WorkspaceInfo = {
        taskId,
        repositoryId,
        workspaceDir,
        branchName,
        worktreeCreated: false,
        claudeLocalPath,
        createdAt: new Date()
      };

      await this.dependencies.stateManager.saveWorkspaceInfo(workspaceInfo);
      
      this.dependencies.logger.info('Workspace created', {
        taskId,
        repositoryId,
        workspaceDir
      });

      return workspaceInfo;

    } catch (error) {
      const managerError: ManagerError = {
        message: error instanceof Error ? error.message : 'Workspace creation failed',
        code: 'WORKSPACE_CREATION_ERROR',
        timestamp: new Date(),
        context: { taskId, repositoryId, error }
      };
      
      this.errors.push(managerError);
      this.dependencies.logger.error('Failed to create workspace', { error: managerError });
      throw error;
    }
  }

  async setupWorktree(workspaceInfo: WorkspaceInfo): Promise<void> {
    if (workspaceInfo.worktreeCreated) {
      this.dependencies.logger.debug('Worktree already created, skipping', {
        taskId: workspaceInfo.taskId
      });
      return;
    }

    try {
      // RepositoryManager를 통해 저장소 확인 및 경로 가져오기
      const repositoryPath = await this.dependencies.repositoryManager.ensureRepository(
        workspaceInfo.repositoryId
      );

      await this.dependencies.gitService.createWorktree(
        repositoryPath,
        workspaceInfo.branchName,
        workspaceInfo.workspaceDir
      );

      // RepositoryManager에 worktree 등록
      await this.dependencies.repositoryManager.addWorktree(
        workspaceInfo.repositoryId,
        workspaceInfo.workspaceDir
      );

      const updatedWorkspaceInfo: WorkspaceInfo = {
        ...workspaceInfo,
        worktreeCreated: true
      };

      await this.dependencies.stateManager.saveWorkspaceInfo(updatedWorkspaceInfo);

      this.dependencies.logger.info('Git worktree created', {
        taskId: workspaceInfo.taskId,
        branchName: workspaceInfo.branchName,
        repositoryPath
      });

    } catch (error) {
      this.dependencies.logger.error('Failed to create git worktree', {
        taskId: workspaceInfo.taskId,
        error
      });
      throw error;
    }
  }

  async setupClaudeLocal(workspaceInfo: WorkspaceInfo): Promise<void> {
    try {
      const claudeLocalContent = this.generateClaudeLocalContent(workspaceInfo);
      
      await fs.writeFile(workspaceInfo.claudeLocalPath, claudeLocalContent, 'utf-8');
      
      this.dependencies.logger.info('CLAUDE.local.md created', {
        taskId: workspaceInfo.taskId,
        path: workspaceInfo.claudeLocalPath
      });

    } catch (error) {
      this.dependencies.logger.error('Failed to create CLAUDE.local.md', {
        taskId: workspaceInfo.taskId,
        error
      });
      throw error;
    }
  }

  async cleanupWorkspace(taskId: string): Promise<void> {
    try {
      const workspaceInfo = await this.dependencies.stateManager.loadWorkspaceInfo(taskId);
      
      if (!workspaceInfo) {
        this.dependencies.logger.debug('No workspace found for cleanup', { taskId });
        return;
      }

      // Git worktree 제거 (에러가 발생해도 계속 진행)
      if (workspaceInfo.worktreeCreated) {
        try {
          const repositoryPath = await this.dependencies.repositoryManager.ensureRepository(
            workspaceInfo.repositoryId
          );
          await this.dependencies.gitService.removeWorktree(
            repositoryPath,
            workspaceInfo.workspaceDir
          );
          
          // RepositoryManager에서 worktree 제거
          await this.dependencies.repositoryManager.removeWorktree(
            workspaceInfo.repositoryId,
            workspaceInfo.workspaceDir
          );
        } catch (error) {
          this.dependencies.logger.warn('Failed to remove git worktree during cleanup', {
            taskId,
            error
          });
        }
      }

      // 워크스페이스 디렉토리 제거
      try {
        await fs.rm(workspaceInfo.workspaceDir, { recursive: true, force: true });
      } catch (error) {
        this.dependencies.logger.warn('Failed to remove workspace directory during cleanup', {
          taskId,
          workspaceDir: workspaceInfo.workspaceDir,
          error
        });
      }

      // 상태 정보 제거
      await this.dependencies.stateManager.removeWorkspaceInfo(taskId);

      this.dependencies.logger.info('Workspace cleaned up', { taskId });

    } catch (error) {
      const managerError: ManagerError = {
        message: error instanceof Error ? error.message : 'Workspace cleanup failed',
        code: 'WORKSPACE_CLEANUP_ERROR',
        timestamp: new Date(),
        context: { taskId, error }
      };
      
      this.errors.push(managerError);
      this.dependencies.logger.error('Failed to cleanup workspace', { error: managerError });
      throw error;
    }
  }

  async getWorkspaceInfo(taskId: string): Promise<WorkspaceInfo | null> {
    return await this.dependencies.stateManager.loadWorkspaceInfo(taskId);
  }

  private validateInputs(taskId: string, repositoryId: string): void {
    if (!taskId.trim()) {
      throw new Error('Task ID cannot be empty');
    }
    if (!repositoryId.trim()) {
      throw new Error('Repository ID cannot be empty');
    }
  }

  private generateWorkspaceDirectory(repositoryId: string, taskId: string): string {
    const safeRepositoryId = repositoryId.replace('/', '_');
    return path.join(this.config.workspaceBasePath, `${safeRepositoryId}_${taskId}`);
  }

  private async checkDirectoryExists(dirPath: string): Promise<boolean> {
    try {
      await fs.access(dirPath);
      return true;
    } catch {
      return false;
    }
  }


  private generateClaudeLocalContent(workspaceInfo: WorkspaceInfo): string {
    return `# 작업 지침

## 작업 정보
- **작업 ID**: ${workspaceInfo.taskId}
- **저장소**: ${workspaceInfo.repositoryId}
- **브랜치**: ${workspaceInfo.branchName}
- **작업 디렉토리**: ${workspaceInfo.workspaceDir}

## 개발 방침

### TDD (테스트 주도 개발)
1. 요구사항에 따른 모든 테스트 코드를 먼저 작성
2. 테스트 실행하여 실패 확인 (Red)
3. 테스트를 통과하는 최소한의 코드 작성 (Green)
4. 코드 리팩토링 (Refactor)

### SOLID 원칙 준수
- **단일 책임 원칙**: 각 클래스는 하나의 책임만
- **개방-폐쇄 원칙**: 확장에는 열려있고 수정에는 닫혀있게
- **리스코프 치환 원칙**: 하위 타입은 상위 타입을 대체 가능하게
- **인터페이스 분리 원칙**: 필요한 인터페이스만 의존하게
- **의존성 역전 원칙**: 구체적인 것이 추상적인 것에 의존하게

### Clean Code 원칙
- 의미 있는 이름 사용
- 함수는 한 가지 일만 하고 20줄 이내로 작성
- 설명 변수 적극 활용
- 일관성 있는 코드 스타일

### 테스트 규칙
- Given-When-Then 패턴 적용
- 예외 상황 테스트 포함
- **테스트 커버리지 80% 이상 유지**

### 기타
- 불변 객체로 값 객체 설계
- TypeScript 엄격 모드 준수
- 적절한 로깅 및 에러 처리

## 작업 완료 기준
1. 모든 테스트 통과
2. 테스트 커버리지 80% 이상
3. 린트 에러 없음
4. 타입 에러 없음
5. PR 작성 및 리뷰 준비 완료
`;
  }
}
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

  async createWorkspace(taskId: string, repositoryId: string, boardItem?: any): Promise<WorkspaceInfo> {
    this.validateInputs(taskId, repositoryId);

    try {
      const workspaceDir = this.generateWorkspaceDirectory(repositoryId, taskId);
      // boardItem에서 contentNumber와 contentType 정보를 사용하여 브랜치명 생성
      let branchName = this.generateBranchName(taskId, boardItem);
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
    // 이미 생성된 worktree인지 확인 (플래그 + 실제 존재 여부)
    if (workspaceInfo.worktreeCreated) {
      const isWorktreeValid = await this.isWorktreeValid(workspaceInfo);
      if (isWorktreeValid) {
        this.dependencies.logger.debug('Worktree already exists and is valid, skipping', {
          taskId: workspaceInfo.taskId,
          workspaceDir: workspaceInfo.workspaceDir
        });
        return;
      } else {
        this.dependencies.logger.warn('Worktree flag is set but worktree is invalid, recreating', {
          taskId: workspaceInfo.taskId,
          workspaceDir: workspaceInfo.workspaceDir
        });
      }
    }

    try {
      // RepositoryManager를 통해 저장소 확인 및 경로 가져오기
      // 새 작업 시작 시에는 항상 최신 상태로 업데이트
      const repositoryPath = await this.dependencies.repositoryManager.ensureRepository(
        workspaceInfo.repositoryId,
        true // forceUpdate = true
      );

      // 워크스페이스 디렉토리가 이미 Git worktree인지 확인
      const isExistingWorktree = await this.isWorktreeValid(workspaceInfo);
      if (isExistingWorktree) {
        this.dependencies.logger.info('Worktree already exists, updating state', {
          taskId: workspaceInfo.taskId,
          workspaceDir: workspaceInfo.workspaceDir
        });
      } else {
        await this.dependencies.gitService.createWorktree(
          repositoryPath,
          workspaceInfo.branchName,
          workspaceInfo.workspaceDir
        );
      }

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
      // 워크스페이스 디렉토리가 존재하는지 먼저 확인하고, 없으면 생성
      await fs.access(workspaceInfo.workspaceDir).catch(async () => {
        await fs.mkdir(workspaceInfo.workspaceDir, { recursive: true });
        this.dependencies.logger.info('Created missing workspace directory for CLAUDE.local.md', {
          taskId: workspaceInfo.taskId,
          workspaceDir: workspaceInfo.workspaceDir
        });
      });

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

  /**
   * boardItem 정보를 기반으로 브랜치명을 생성합니다.
   * contentNumber가 있으면 issue-123 또는 pr-456 형태로 생성하고,
   * 없으면 taskId를 사용합니다.
   */
  private generateBranchName(taskId: string, boardItem?: any): string {
    // boardItem에서 contentNumber와 contentType 정보를 우선 사용
    if (boardItem?.contentNumber && boardItem?.contentType) {
      const prefix = boardItem.contentType === 'pull_request' ? 'pr' : 'issue';
      const branchName = `${prefix}-${boardItem.contentNumber}`;
      
      this.dependencies.logger.debug('Generated branch name from contentNumber', {
        taskId,
        contentNumber: boardItem.contentNumber,
        contentType: boardItem.contentType,
        branchName
      });
      
      return branchName;
    }

    // boardItem.title에서 이슈번호 추출 시도 (예: "Fix bug #123")
    if (boardItem?.title) {
      const issueMatch = boardItem.title.match(/#(\d+)/);
      if (issueMatch) {
        const issueNumber = issueMatch[1];
        const branchName = `issue-${issueNumber}`;
        
        this.dependencies.logger.debug('Generated branch name from title', {
          taskId,
          title: boardItem.title,
          issueNumber,
          branchName
        });
        
        return branchName;
      }
    }

    // 최종 대안: taskId 사용 (하지만 가능한 한 짧게)
    const shortTaskId = taskId.length > 20 ? taskId.substring(0, 20) : taskId;
    
    this.dependencies.logger.warn('Using taskId as branch name (no contentNumber available)', {
      taskId,
      shortTaskId,
      boardItem: boardItem ? {
        contentNumber: boardItem.contentNumber,
        contentType: boardItem.contentType,
        title: boardItem.title
      } : null
    });
    
    return shortTaskId;
  }

  /**
   * 워크스페이스 디렉토리가 유효한지 확인합니다.
   * 디렉토리가 존재하면 기본적으로 유효한 것으로 간주합니다.
   */
  async isWorktreeValid(workspaceInfo: WorkspaceInfo): Promise<boolean> {
    try {
      // 디렉토리 존재 확인 - 이것이 가장 중요한 검증
      const directoryExists = await this.checkDirectoryExists(workspaceInfo.workspaceDir);
      if (!directoryExists) {
        return false;
      }

      // 디렉토리가 있으면 기본적으로 유효한 것으로 간주
      // Git 워크트리 세부 검증은 선택적으로 수행
      const gitPath = path.join(workspaceInfo.workspaceDir, '.git');
      try {
        const gitContent = await fs.readFile(gitPath, 'utf-8');
        // Git worktree는 .git 파일에 "gitdir: ..." 형태로 저장됨
        const isWorktree = gitContent.trim().startsWith('gitdir:');
        
        this.dependencies.logger.debug('Worktree validation result', {
          taskId: workspaceInfo.taskId,
          workspaceDir: workspaceInfo.workspaceDir,
          gitPath,
          isWorktree,
          gitContent: gitContent.substring(0, 100) // 첫 100자만 로그
        });

        // Git worktree가 아니어도 디렉토리가 있으면 재사용 가능
        if (!isWorktree) {
          this.dependencies.logger.info('Directory exists but not a valid worktree, will be reused anyway', {
            taskId: workspaceInfo.taskId,
            workspaceDir: workspaceInfo.workspaceDir
          });
        }

        return true; // 디렉토리가 있으면 항상 유효
      } catch {
        // .git 파일이 없어도 디렉토리가 있으면 사용 가능
        this.dependencies.logger.debug('.git file not found, but directory exists and will be reused', {
          taskId: workspaceInfo.taskId,
          workspaceDir: workspaceInfo.workspaceDir
        });
        return true;
      }
    } catch (error) {
      this.dependencies.logger.error('Error validating workspace directory', {
        taskId: workspaceInfo.taskId,
        workspaceDir: workspaceInfo.workspaceDir,
        error
      });
      return false;
    }
  }
}
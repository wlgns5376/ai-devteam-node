import { 
  WorkspaceSetupInterface,
  WorkerTask,
  WorkerAction,
  WorkspaceInfo
} from '@/types';
import { Logger } from '../logger';
import { BaseBranchExtractor } from '../git';
import fs from 'fs/promises';

interface WorkspaceSetupDependencies {
  readonly logger: Logger;
  readonly workspaceManager: any; // WorkspaceManager interface with isWorktreeValid method
  readonly baseBranchExtractor: BaseBranchExtractor;
}

export class WorkspaceSetup implements WorkspaceSetupInterface {
  constructor(
    private readonly dependencies: WorkspaceSetupDependencies
  ) {}

  async prepareWorkspace(task: WorkerTask): Promise<WorkspaceInfo> {
    try {
      this.validateTask(task);

      this.dependencies.logger.info('Preparing workspace', {
        taskId: task.taskId,
        action: task.action,
        repositoryId: task.repositoryId
      });

      // 기존 워크스페이스 확인 (모든 작업 타입에 대해)
      const existingWorkspace = await this.dependencies.workspaceManager.getWorkspaceInfo(task.taskId);
      if (existingWorkspace) {
        // 기존 워크스페이스가 유효한지 검증
        const isValid = await this.validateEnvironment(existingWorkspace);
        if (isValid) {
          this.dependencies.logger.info('Reusing existing workspace', {
            taskId: task.taskId,
            workspaceDir: existingWorkspace.workspaceDir,
            action: task.action
          });
          return existingWorkspace;
        } else {
          this.dependencies.logger.warn('Existing workspace is invalid, creating new one', {
            taskId: task.taskId,
            workspaceDir: existingWorkspace.workspaceDir
          });
          // 유효하지 않은 워크스페이스 정리
          await this.dependencies.workspaceManager.cleanupWorkspace(task.taskId);
        }
      }

      // 새 워크스페이스 생성
      let workspaceInfo = await this.dependencies.workspaceManager.createWorkspace(
        task.taskId,
        task.repositoryId,
        task.boardItem
      );

      // Base branch 추출
      const baseBranch = await this.dependencies.baseBranchExtractor.extractBaseBranch(task);

      // Git worktree 설정
      await this.dependencies.workspaceManager.setupWorktree(workspaceInfo, baseBranch);

      // CLAUDE.local.md 설정
      await this.dependencies.workspaceManager.setupClaudeLocal(workspaceInfo);

      // 최종 워크스페이스 정보 업데이트
      workspaceInfo = {
        ...workspaceInfo,
        worktreeCreated: true
      };

      this.dependencies.logger.info('Workspace prepared successfully', {
        taskId: task.taskId,
        workspaceDir: workspaceInfo.workspaceDir
      });

      return workspaceInfo;

    } catch (error) {
      const errorMessage = `Failed to prepare workspace for task ${task.taskId}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      
      this.dependencies.logger.error('Failed to prepare workspace', {
        taskId: task.taskId,
        error
      });
      
      throw new Error(errorMessage);
    }
  }

  async validateEnvironment(workspaceInfo: WorkspaceInfo): Promise<boolean> {
    try {
      // 기본 디렉토리 존재 확인
      await fs.access(workspaceInfo.workspaceDir);
      
      // 디렉토리인지 확인
      const stat = await fs.stat(workspaceInfo.workspaceDir);
      if (!stat.isDirectory()) {
        throw new Error('Workspace path is not a directory');
      }

      // CLAUDE.local.md 파일 존재 확인 - 없으면 생성할 수 있으므로 선택적으로 확인
      try {
        await fs.access(workspaceInfo.claudeLocalPath);
      } catch {
        this.dependencies.logger.debug('CLAUDE.local.md not found, but workspace directory is valid', {
          taskId: workspaceInfo.taskId
        });
      }

      // Git worktree 검증은 선택적으로 수행 - 실패해도 디렉토리가 있으면 재사용
      if (this.dependencies.workspaceManager && typeof this.dependencies.workspaceManager.isWorktreeValid === 'function') {
        try {
          const isWorktreeValid = await this.dependencies.workspaceManager.isWorktreeValid(workspaceInfo);
          if (!isWorktreeValid) {
            this.dependencies.logger.info('Git worktree validation failed, but reusing existing directory', {
              taskId: workspaceInfo.taskId,
              reason: 'Directory exists and will be reused'
            });
          }
        } catch (worktreeError) {
          this.dependencies.logger.debug('Git worktree validation error, but continuing with existing directory', {
            taskId: workspaceInfo.taskId,
            error: worktreeError
          });
        }
      }

      this.dependencies.logger.debug('Workspace environment validation passed', {
        taskId: workspaceInfo.taskId
      });

      return true;

    } catch (error) {
      this.dependencies.logger.warn('Workspace environment validation failed', {
        taskId: workspaceInfo.taskId,
        reason: 'Directory not accessible',
        error: error instanceof Error ? error.message : String(error)
      });

      return false;
    }
  }

  async cleanupWorkspace(taskId: string): Promise<void> {
    try {
      await this.dependencies.workspaceManager.cleanupWorkspace(taskId);
      
      this.dependencies.logger.info('Workspace cleanup completed', {
        taskId
      });

    } catch (error) {
      // 정리 작업 실패는 심각한 에러가 아니므로 로그만 남기고 계속 진행
      this.dependencies.logger.error('Failed to cleanup workspace', {
        taskId,
        error
      });
    }
  }

  private validateTask(task: WorkerTask): void {
    if (!task.taskId || task.taskId.trim() === '') {
      throw new Error('Invalid task: taskId cannot be empty');
    }

    if (!task.repositoryId || task.repositoryId.trim() === '') {
      throw new Error('Invalid task: repositoryId cannot be empty');
    }

    if (!task.action) {
      throw new Error('Invalid task: action cannot be empty');
    }

    if (!task.assignedAt) {
      throw new Error('Invalid task: assignedAt cannot be empty');
    }
  }
}
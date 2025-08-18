import { WorkspaceInfo } from '@/types';
import { WorkspaceManagerInterface } from '@/types/manager.types';
import { Logger } from '../logger';

export interface TaskReassignmentCheck {
  allowed: boolean;
  hasWorkspace: boolean;
  workspaceInfo?: WorkspaceInfo | null;
  reason?: string;
}

interface TaskAssignmentValidatorDependencies {
  readonly logger: Logger;
  readonly workspaceManager?: WorkspaceManagerInterface | undefined;
}

/**
 * 작업 재할당 가능성을 검증하는 유틸리티 클래스
 * workspace 존재 여부와 유효성을 확인하여 idle Worker에게 재할당할 수 있는지 판단
 */
export class TaskAssignmentValidator {
  constructor(
    private readonly dependencies: TaskAssignmentValidatorDependencies
  ) {}

  /**
   * 작업 재할당 가능성을 검증합니다.
   * workspace 존재 여부를 확인하여 idle Worker에게 재할당할 수 있는지 판단합니다.
   */
  async validateTaskReassignment(taskId: string, boardItem?: any): Promise<TaskReassignmentCheck> {
    try {
      if (!this.dependencies.workspaceManager) {
        this.dependencies.logger.warn('WorkspaceManager not available for task reassignment validation', {
          taskId
        });
        return {
          allowed: false,
          hasWorkspace: false,
          reason: 'WorkspaceManager not available'
        };
      }

      // 기존 workspace 정보 조회
      const workspaceInfo = await this.dependencies.workspaceManager.getWorkspaceInfo(taskId);
      
      if (!workspaceInfo) {
        this.dependencies.logger.debug('No existing workspace found for task', {
          taskId
        });
        return {
          allowed: true,
          hasWorkspace: false,
          workspaceInfo: null,
          reason: 'No existing workspace - will create new one'
        };
      }

      // workspace 유효성 검증
      const isWorkspaceValid = await this.dependencies.workspaceManager.isWorktreeValid(workspaceInfo);
      
      if (!isWorkspaceValid) {
        this.dependencies.logger.debug('Existing workspace is invalid', {
          taskId,
          workspaceDir: workspaceInfo.workspaceDir
        });
        return {
          allowed: true,
          hasWorkspace: false,
          workspaceInfo,
          reason: 'Invalid workspace - will recreate'
        };
      }

      this.dependencies.logger.info('Valid workspace found for task reassignment', {
        taskId,
        workspaceDir: workspaceInfo.workspaceDir,
        branchName: workspaceInfo.branchName
      });

      return {
        allowed: true,
        hasWorkspace: true,
        workspaceInfo,
        reason: 'Valid workspace exists - can resume task'
      };

    } catch (error) {
      this.dependencies.logger.error('Error checking task reassignment possibility', {
        taskId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      return {
        allowed: false,
        hasWorkspace: false,
        reason: 'Error during workspace validation'
      };
    }
  }

  /**
   * 특정 작업에 대해 사용 가능한 Worker가 존재하는지 확인합니다.
   * workspace 상태와 Worker 상태를 종합적으로 고려하여 판단합니다.
   */
  async canAssignToIdleWorker(taskId: string, workerId: string, boardItem?: any): Promise<boolean> {
    const reassignmentCheck = await this.validateTaskReassignment(taskId, boardItem);
    
    // workspace가 존재하지 않으면 idle Worker에게 할당 불가
    if (!reassignmentCheck.hasWorkspace) {
      this.dependencies.logger.debug('Cannot assign to idle worker - no valid workspace', {
        taskId,
        workerId,
        reason: reassignmentCheck.reason
      });
      return false;
    }

    this.dependencies.logger.info('Idle worker can be assigned to task with existing workspace', {
      taskId,
      workerId,
      workspaceDir: reassignmentCheck.workspaceInfo?.workspaceDir
    });

    return true;
  }

  /**
   * 작업 재할당 우선순위를 결정합니다.
   * 기존 workspace가 있는 작업에 높은 우선순위를 부여합니다.
   */
  async getTaskReassignmentPriority(taskId: string): Promise<number> {
    const reassignmentCheck = await this.validateTaskReassignment(taskId);
    
    if (!reassignmentCheck.allowed) {
      return 0; // 재할당 불가
    }
    
    if (reassignmentCheck.hasWorkspace) {
      return 10; // 높은 우선순위 - 기존 workspace 존재
    }
    
    return 5; // 중간 우선순위 - 새 workspace 생성 필요
  }
}
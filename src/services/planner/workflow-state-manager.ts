import { WorkflowState, TaskInfo } from '@/types';
import { Logger } from '@/services/logger';

/**
 * 워크플로우 상태 관리를 담당하는 클래스
 * - 활성 작업 추적
 * - 처리된 작업 기록  
 * - 상태 초기화 및 복원
 */
export class WorkflowStateManager {
  private workflowState: WorkflowState;

  constructor(private readonly logger: Logger) {
    this.workflowState = {
      processedTasks: new Set(),
      processedComments: new Set(),
      activeTasks: new Map()
    };
  }

  /**
   * 워크플로우 상태 초기화
   */
  initializeState(): void {
    this.workflowState = {
      processedTasks: new Set(),
      processedComments: new Set(),
      activeTasks: new Map()
    };
  }

  /**
   * 현재 워크플로우 상태 반환
   */
  getState(): WorkflowState {
    return {
      ...this.workflowState,
      processedTasks: new Set(this.workflowState.processedTasks),
      processedComments: new Set(this.workflowState.processedComments),
      activeTasks: new Map(this.workflowState.activeTasks)
    };
  }

  /**
   * 작업이 이미 처리되었는지 확인
   */
  isTaskProcessed(taskId: string): boolean {
    return this.workflowState.processedTasks.has(taskId);
  }

  /**
   * 작업이 현재 활성 상태인지 확인
   */
  isTaskActive(taskId: string): boolean {
    return this.workflowState.activeTasks.has(taskId);
  }

  /**
   * 작업을 처리됨으로 표시
   */
  markTaskAsProcessed(taskId: string): void {
    this.workflowState.processedTasks.add(taskId);
  }

  /**
   * 작업을 처리됨에서 제거 (재처리를 위해)
   */
  unmarkTaskAsProcessed(taskId: string): void {
    this.workflowState.processedTasks.delete(taskId);
    this.workflowState.activeTasks.delete(taskId);
    
    this.logger.info('Task removed from processed list for reprocessing', {
      taskId
    });
  }

  /**
   * 활성 작업으로 추가
   */
  addActiveTask(taskId: string, status: 'IN_PROGRESS' | 'IN_REVIEW'): void {
    const now = new Date();
    this.workflowState.activeTasks.set(taskId, {
      taskId,
      status,
      startedAt: now,
      lastUpdatedAt: now
    });
    
    this.logger.debug('Task added to active tasks', {
      taskId,
      status
    });
  }

  /**
   * 활성 작업 상태 업데이트
   */
  updateActiveTaskStatus(taskId: string, status: 'IN_PROGRESS' | 'IN_REVIEW'): void {
    const taskInfo = this.workflowState.activeTasks.get(taskId);
    if (taskInfo) {
      this.workflowState.activeTasks.set(taskId, {
        ...taskInfo,
        status,
        lastUpdatedAt: new Date()
      });
      
      this.logger.debug('Active task status updated', {
        taskId,
        status
      });
    }
  }

  /**
   * 활성 작업에서 제거
   */
  removeActiveTask(taskId: string): void {
    this.workflowState.activeTasks.delete(taskId);
    
    this.logger.debug('Task removed from active tasks', {
      taskId
    });
  }

  /**
   * 활성 작업 정보 조회
   */
  getActiveTaskInfo(taskId: string): TaskInfo | undefined {
    return this.workflowState.activeTasks.get(taskId);
  }

  /**
   * 마지막 동기화 시간 업데이트
   */
  updateLastSyncTime(time: Date): void {
    this.workflowState.lastSyncTime = time;
  }

  /**
   * 통계 정보 반환
   */
  getStats(): {
    processedTasksCount: number;
    activeTasksCount: number;
    lastSyncTime?: Date;
  } {
    const stats = {
      processedTasksCount: this.workflowState.processedTasks.size,
      activeTasksCount: this.workflowState.activeTasks.size
    } as {
      processedTasksCount: number;
      activeTasksCount: number;
      lastSyncTime?: Date;
    };

    if (this.workflowState.lastSyncTime) {
      stats.lastSyncTime = this.workflowState.lastSyncTime;
    }

    return stats;
  }

  /**
   * 기존 프로젝트 보드 상태에서 워크플로우 상태 복원
   */
  restoreFromProjectBoardItems(
    doneItems: any[],
    inProgressItems: any[],
    inReviewItems: any[]
  ): void {
    const now = new Date();

    // DONE 상태 작업들을 처리된 작업으로 기록
    for (const item of doneItems) {
      this.workflowState.processedTasks.add(item.id);
      this.logger.debug('Restored completed task', {
        taskId: item.id,
        title: item.title,
        status: 'DONE'
      });
    }

    // IN_PROGRESS 상태 작업들을 활성 작업으로 기록
    for (const item of inProgressItems) {
      this.workflowState.processedTasks.add(item.id);
      this.workflowState.activeTasks.set(item.id, {
        taskId: item.id,
        status: 'IN_PROGRESS',
        startedAt: now,
        lastUpdatedAt: now
      });
      this.logger.debug('Restored active task', {
        taskId: item.id,
        title: item.title,
        status: 'IN_PROGRESS'
      });
    }

    // IN_REVIEW 상태 작업들을 활성 작업으로 기록
    for (const item of inReviewItems) {
      this.workflowState.processedTasks.add(item.id);
      this.workflowState.activeTasks.set(item.id, {
        taskId: item.id,
        status: 'IN_REVIEW',
        startedAt: now,
        lastUpdatedAt: now
      });
      this.logger.debug('Restored review task', {
        taskId: item.id,
        title: item.title,
        status: 'IN_REVIEW'
      });
    }

    this.logger.info('Workflow state restored successfully', {
      totalProcessedTasks: this.workflowState.processedTasks.size,
      totalActiveTasks: this.workflowState.activeTasks.size,
      doneItemsCount: doneItems.length,
      inProgressItemsCount: inProgressItems.length,
      inReviewItemsCount: inReviewItems.length
    });
  }
}
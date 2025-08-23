import { 
  PlannerServiceConfig,
  PlannerDependencies,
  TaskAction,
  TaskRequest,
  ResponseStatus
} from '@/types';
import { WorkflowStateManager } from './workflow-state-manager';
import { PlannerErrorManager } from './planner-error-manager';
import { Logger } from '@/services/logger';

/**
 * 신규 작업 처리를 담당하는 클래스
 * - TODO 상태 작업 조회 및 처리
 * - Manager에게 작업 전달
 * - 작업 상태 업데이트
 */
export class NewTaskHandler {
  constructor(
    private readonly config: PlannerServiceConfig,
    private readonly dependencies: PlannerDependencies,
    private readonly workflowStateManager: WorkflowStateManager,
    private readonly errorManager: PlannerErrorManager,
    private readonly logger: Logger
  ) {}

  /**
   * 신규 작업들을 처리
   */
  async handle(): Promise<number> {
    let processedCount = 0;

    try {
      this.logger.debug('Starting new task handling');

      const todoItems = await this.getTodoItems();
      
      this.logger.debug('Retrieved TODO items for processing', {
        totalTodoItems: todoItems.length,
        processedTasksCount: this.workflowStateManager.getStats().processedTasksCount,
        activeTasksCount: this.workflowStateManager.getStats().activeTasksCount
      });

      for (const item of todoItems) {
        try {
          const processed = await this.processItem(item);
          if (processed) {
            processedCount++;
          }
        } catch (error) {
          this.logger.error('Failed to process new task', {
            taskId: item.id,
            title: item.title,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
          });
          
          this.errorManager.addError(
            'TASK_START_ERROR', 
            `Failed to start task ${item.id}`, 
            { error, taskId: item.id }
          );
        }
      }

      this.logger.debug('New task handling completed', { processedCount });
      return processedCount;

    } catch (error) {
      this.logger.error('Failed to handle new tasks', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      
      this.errorManager.addError('NEW_TASKS_ERROR', 'Failed to handle new tasks', { error });
      return processedCount;
    }
  }

  /**
   * TODO 상태 작업 조회
   */
  private async getTodoItems() {
    return await this.dependencies.projectBoardService.getItems(
      this.config.boardId, 
      'TODO'
    );
  }

  /**
   * 개별 작업 아이템 처리
   */
  private async processItem(item: any): Promise<boolean> {
    // TODO로 돌아온 작업은 다시 처리할 수 있도록 처리됨에서 제거
    if (this.workflowStateManager.isTaskProcessed(item.id)) {
      this.workflowStateManager.unmarkTaskAsProcessed(item.id);
    }

    // 현재 활성 작업인지 확인
    if (this.workflowStateManager.isTaskActive(item.id)) {
      const activeStatus = this.workflowStateManager.getActiveTaskInfo(item.id)?.status;
      this.logger.debug('Skipping currently active task', {
        taskId: item.id,
        title: item.title,
        activeStatus
      });
      return false;
    }

    this.logger.info('Processing new task', {
      taskId: item.id,
      title: item.title,
      status: item.status
    });

    // Manager에게 작업 전달
    const request: TaskRequest = {
      taskId: item.id,
      action: TaskAction.START_NEW_TASK,
      boardItem: item
    };

    const response = await this.dependencies.managerCommunicator.sendTaskToManager(request);

    if (response.status === ResponseStatus.ACCEPTED) {
      return await this.handleAcceptedTask(item);
    } else {
      return this.handleRejectedTask(item, response);
    }
  }

  /**
   * 수락된 작업 처리
   */
  private async handleAcceptedTask(item: any): Promise<boolean> {
    this.logger.info('Task accepted by manager, updating status to IN_PROGRESS', {
      taskId: item.id,
      title: item.title
    });

    // 작업 상태를 IN_PROGRESS로 변경
    const updatedItem = await this.dependencies.projectBoardService.updateItemStatus(
      item.id, 
      'IN_PROGRESS'
    );
    
    // 상태 변경 검증
    if (updatedItem.status !== 'IN_PROGRESS') {
      this.logger.error('Status update failed - item status mismatch', {
        taskId: item.id,
        expectedStatus: 'IN_PROGRESS',
        actualStatus: updatedItem.status,
        title: item.title
      });
      
      this.errorManager.addError(
        'STATUS_UPDATE_FAILED', 
        `Failed to update task ${item.id} status to IN_PROGRESS`, 
        { 
          taskId: item.id, 
          expectedStatus: 'IN_PROGRESS',
          actualStatus: updatedItem.status
        }
      );
      return false;
    }
    
    // 워크플로우 상태 업데이트
    this.workflowStateManager.markTaskAsProcessed(item.id);
    this.workflowStateManager.addActiveTask(item.id, 'IN_PROGRESS');
    
    this.logger.info('New task started successfully', {
      taskId: item.id,
      title: item.title,
      verifiedStatus: updatedItem.status
    });

    return true;
  }

  /**
   * 거부된 작업 처리
   */
  private handleRejectedTask(item: any, response: any): boolean {
    this.logger.warn('Task rejected by manager', {
      taskId: item.id,
      title: item.title,
      reason: response.message,
      responseStatus: response.status
    });
    
    // 거부된 작업도 처리된 것으로 기록하여 재시도 방지
    this.workflowStateManager.markTaskAsProcessed(item.id);
    return false;
  }
}
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
 * 진행중 작업 처리를 담당하는 클래스
 * - IN_PROGRESS 상태 작업 조회 및 처리
 * - 작업 상태 확인 및 업데이트
 * - 완료된 작업의 리뷰 단계 이동
 */
export class InProgressTaskHandler {
  constructor(
    private readonly config: PlannerServiceConfig,
    private readonly dependencies: PlannerDependencies,
    private readonly workflowStateManager: WorkflowStateManager,
    private readonly errorManager: PlannerErrorManager,
    private readonly logger: Logger
  ) {}

  /**
   * 진행중 작업들을 처리
   */
  async handle(): Promise<void> {
    try {
      this.logger.debug('Starting in-progress task handling');

      const inProgressItems = await this.getInProgressItems();

      for (const item of inProgressItems) {
        try {
          await this.processItem(item);
        } catch (error) {
          this.errorManager.addError(
            'TASK_STATUS_CHECK_ERROR', 
            `Failed to check status for task ${item.id}`, 
            { error, taskId: item.id }
          );
        }
      }

      this.logger.debug('In-progress task handling completed');

    } catch (error) {
      this.errorManager.addError('IN_PROGRESS_TASKS_ERROR', 'Failed to handle in-progress tasks', { error });
    }
  }

  /**
   * IN_PROGRESS 상태 작업 조회
   */
  private async getInProgressItems() {
    return await this.dependencies.projectBoardService.getItems(
      this.config.boardId,
      'IN_PROGRESS'
    );
  }

  /**
   * 개별 진행중 작업 처리
   */
  private async processItem(item: any): Promise<void> {
    this.logger.debug('Processing in-progress item', {
      taskId: item.id,
      title: item.title
    });

    // Manager에게 작업 상태 확인
    const request: TaskRequest = {
      taskId: item.id,
      action: TaskAction.CHECK_STATUS,
      boardItem: item
    };

    const response = await this.dependencies.managerCommunicator.sendTaskToManager(request);

    if (response.status === ResponseStatus.COMPLETED && response.pullRequestUrl) {
      await this.handleCompletedTask(item, response.pullRequestUrl);
    } else if (response.status === ResponseStatus.COMPLETED && response.message === 'merged') {
      await this.handleMergedTask(item);
    } else if (response.status === ResponseStatus.ERROR) {
      this.handleTaskError(item, response);
    } else {
      this.logger.debug('Task still in progress', {
        taskId: item.id,
        responseStatus: response.status
      });
    }
  }

  /**
   * 완료된 작업을 리뷰 단계로 이동
   */
  private async handleCompletedTask(item: any, pullRequestUrl: string): Promise<void> {
    this.logger.info('Moving completed task to review', {
      taskId: item.id,
      pullRequestUrl
    });

    // 작업을 IN_REVIEW로 변경
    await this.dependencies.projectBoardService.updateItemStatus(item.id, 'IN_REVIEW');
    
    // PR URL을 아이템에 추가
    await this.dependencies.projectBoardService.addPullRequestToItem(item.id, pullRequestUrl);
    
    // 활성 작업 상태 업데이트
    this.workflowStateManager.updateActiveTaskStatus(item.id, 'IN_REVIEW');
    
    this.logger.info('Task moved to review successfully', {
      taskId: item.id,
      pullRequestUrl
    });
  }

  /**
   * 병합 완료된 작업을 완료 처리
   */
  private async handleMergedTask(item: any): Promise<void> {
    this.logger.info('Handling merged task', {
      taskId: item.id
    });

    // 병합 완료 시 DONE으로 변경
    await this.dependencies.projectBoardService.updateItemStatus(item.id, 'DONE');
    
    // 완료된 작업을 활성 작업에서 제거
    this.workflowStateManager.removeActiveTask(item.id);
    
    this.logger.info('Task completed after merge', {
      taskId: item.id
    });
  }

  /**
   * 작업 에러 처리
   */
  private handleTaskError(item: any, response: any): void {
    this.logger.error('Worker error detected', {
      taskId: item.id,
      message: response.message
    });

    this.errorManager.addError('WORKER_ERROR', `Worker error for task ${item.id}`, {
      taskId: item.id,
      message: response.message
    });
  }
}
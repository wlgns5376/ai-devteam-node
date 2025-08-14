import { 
  PlannerServiceConfig,
  PlannerDependencies,
  TaskAction,
  TaskRequest,
  ResponseStatus,
  PullRequestState,
  PullRequestComment
} from '@/types';
import { WorkflowStateManager } from './workflow-state-manager';
import { PlannerErrorManager } from './planner-error-manager';
import { Logger } from '@/services/logger';

/**
 * 리뷰 작업 처리를 담당하는 클래스
 * - IN_REVIEW 상태 작업 조회 및 처리
 * - PR 승인 상태 확인
 * - 병합 요청 또는 피드백 처리
 */
export class ReviewTaskHandler {
  constructor(
    private readonly config: PlannerServiceConfig,
    private readonly dependencies: PlannerDependencies,
    private readonly workflowStateManager: WorkflowStateManager,
    private readonly errorManager: PlannerErrorManager,
    private readonly logger: Logger
  ) {}

  /**
   * 리뷰 작업들을 처리
   */
  async handle(): Promise<void> {
    try {
      this.logger.debug('Starting review task handling');

      const reviewItems = await this.getReviewItems();
      
      this.logger.debug('Handling review tasks', {
        boardId: this.config.boardId,
        reviewItemsCount: reviewItems.length
      });

      // 병렬 처리를 위해 Promise.allSettled 사용
      const processingPromises = reviewItems.map(async (item: any) => {
        try {
          await this.processItem(item);
          return { taskId: item.id, success: true };
        } catch (error) {
          this.logger.error('Review task processing error', {
            taskId: item.id,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          this.errorManager.addError(
            'REVIEW_TASK_ERROR', 
            `Failed to handle review task ${item.id}`, 
            { error, taskId: item.id }
          );
          return { taskId: item.id, success: false, error };
        }
      });

      // 모든 작업을 병렬로 처리하고 결과를 기다림
      const results = await Promise.allSettled(processingPromises);
      
      // 처리 결과 로깅
      let successCount = 0;
      let failureCount = 0;
      
      results.forEach((result, index) => {
        const item = reviewItems[index];
        if (result.status === 'fulfilled' && result.value.success) {
          successCount++;
        } else {
          failureCount++;
          this.logger.warn('Review task processing failed', {
            taskId: item.id,
            status: result.status,
            reason: result.status === 'rejected' ? result.reason : result.value.error
          });
        }
      });

      this.logger.info('Review task processing completed', {
        totalTasks: reviewItems.length,
        successCount,
        failureCount,
        processingMode: 'parallel'
      });

      this.logger.debug('Review task handling completed');

    } catch (error) {
      this.errorManager.addError('REVIEW_TASKS_ERROR', 'Failed to handle review tasks', { error });
    }
  }

  /**
   * IN_REVIEW 상태 작업 조회
   */
  private async getReviewItems() {
    return await this.dependencies.projectBoardService.getItems(
      this.config.boardId,
      'IN_REVIEW'
    );
  }

  /**
   * 개별 리뷰 작업 처리
   */
  private async processItem(item: any): Promise<void> {
    this.logger.debug('Processing review item', {
      taskId: item.id,
      title: item.title,
      pullRequestUrls: item.pullRequestUrls
    });
    
    if (!item.pullRequestUrls || item.pullRequestUrls.length === 0) {
      this.logger.warn('Review item has no PR URLs', { taskId: item.id });
      return;
    }

    const prUrl = item.pullRequestUrls[0];
    this.logger.debug('Parsing PR URL', { taskId: item.id, prUrl });
    
    const { repoId, prNumber } = this.parsePullRequestUrl(prUrl);
    
    this.logger.debug('Checking PR status', { taskId: item.id, repoId, prNumber });

    // PR 상태 확인
    const pr = await this.dependencies.pullRequestService.getPullRequest(repoId, prNumber);
    
    this.logger.debug('PR status retrieved', { 
      taskId: item.id, 
      prStatus: pr.status,
      prCreatedAt: pr.createdAt 
    });

    if (pr.status === PullRequestState.MERGED) {
      await this.handleAlreadyMergedPR(item, prUrl);
    } else {
      await this.handleOpenPR(item, prUrl, repoId, prNumber);
    }
  }

  /**
   * 이미 병합된 PR 처리
   */
  private async handleAlreadyMergedPR(item: any, prUrl: string): Promise<void> {
    this.logger.info('PR already merged, completing task', {
      taskId: item.id,
      prUrl
    });

    // 이미 병합됨 -> 완료로 변경
    await this.dependencies.projectBoardService.updateItemStatus(item.id, 'DONE');
    
    // 완료된 작업을 활성 작업에서 제거
    this.workflowStateManager.removeActiveTask(item.id);
    
    // Worker 해제 요청
    await this.releaseWorker(item.id);
    
    this.logger.info('Task completed (already merged)', {
      taskId: item.id,
      prUrl
    });
  }

  /**
   * 열린 PR 처리 (승인 확인 및 피드백 처리)
   */
  private async handleOpenPR(item: any, prUrl: string, repoId: string, prNumber: number): Promise<void> {
    // PR 승인 상태 확인
    this.logger.debug('Checking PR approval status', { taskId: item.id, repoId, prNumber });
    const isApproved = await this.dependencies.pullRequestService.isApproved(repoId, prNumber);
    this.logger.debug('PR approval status checked', { taskId: item.id, isApproved });
    
    if (isApproved) {
      await this.handleApprovedPR(item, prUrl);
    } else {
      await this.handleUnapprovedPR(item, prUrl, repoId, prNumber);
    }
  }

  /**
   * 승인된 PR 처리 (병합 요청)
   */
  private async handleApprovedPR(item: any, prUrl: string): Promise<void> {
    this.logger.info('PR is approved, requesting merge', {
      taskId: item.id,
      prUrl
    });

    // 승인됨 -> Manager에게 병합 요청
    const request: TaskRequest = {
      taskId: item.id,
      action: TaskAction.REQUEST_MERGE,
      pullRequestUrl: prUrl,
      boardItem: item
    };

    const response = await this.dependencies.managerCommunicator.sendTaskToManager(request);

    if (response.status === ResponseStatus.COMPLETED) {
      // 병합이 완료되면 DONE으로 변경
      await this.dependencies.projectBoardService.updateItemStatus(item.id, 'DONE');
      this.workflowStateManager.removeActiveTask(item.id);
      
      // Worker 해제 요청
      await this.releaseWorker(item.id);
      
      this.logger.info('Merge completed successfully', {
        taskId: item.id,
        prUrl
      });
    } else if (response.status === ResponseStatus.ACCEPTED) {
      this.logger.info('Merge request sent to manager', {
        taskId: item.id,
        prUrl
      });
    } else if (response.status === ResponseStatus.ERROR) {
      this.logger.error('Merge failed with error', {
        taskId: item.id,
        reason: response.message
      });
      this.errorManager.addError('MERGE_ERROR', response.message || 'Merge failed', { taskId: item.id });
    } else {
      this.logger.warn('Merge request rejected by manager', {
        taskId: item.id,
        reason: response.message
      });
    }
  }

  /**
   * 미승인 PR 처리 (피드백 확인)
   */
  private async handleUnapprovedPR(item: any, prUrl: string, repoId: string, prNumber: number): Promise<void> {
    this.logger.debug('PR not approved, checking for feedback', {
      taskId: item.id,
      prUrl
    });

    // 리뷰 상태 정보 확인 (로깅 및 분석용)
    const reviews = await this.dependencies.pullRequestService.getReviews(repoId, prNumber);
    
    this.logger.debug('Review status analysis', {
      taskId: item.id,
      reviewCount: reviews.length,
      reviewStates: reviews.map((r: any) => ({ author: r.author, state: r.state, submittedAt: r.submittedAt }))
    });

    // PR 상태와 상관없이 항상 코멘트 확인
    this.logger.debug('Checking for comments regardless of PR approval status', {
      taskId: item.id,
      prUrl
    });

    // 작업별 lastSyncTime 가져오기 (Worker의 currentTask에서 조회)
    const taskLastSyncTime = await this.dependencies.stateManager.getTaskLastSyncTime(item.id);
    const since = taskLastSyncTime || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    this.logger.debug('Using sync time for comment filtering', {
      taskId: item.id,
      lastSyncTime: since.toISOString(),
      syncTimeSource: taskLastSyncTime ? 'worker_task_sync_time' : 'default_7_days_ago',
      taskLastSyncTime: taskLastSyncTime?.toISOString()
    });
    
    // 설정에서 필터링 옵션 가져오기 (환경변수 우선)
    const filterOptions = this.config.pullRequestFilter || {
      excludeAuthor: true, // 기본값
    };
    
    this.logger.debug('Comment filter options', {
      taskId: item.id,
      filterOptions
    });
    
    const newComments = await this.dependencies.pullRequestService.getNewComments(
      repoId, 
      prNumber, 
      since, 
      filterOptions
    );

    this.logger.debug('Comment check result', {
      taskId: item.id,
      since: since.toISOString(),
      newCommentCount: newComments.length,
      commentDetails: newComments.map((c: PullRequestComment) => ({
        id: c.id,
        author: c.author,
        createdAt: c.createdAt.toISOString(),
        type: c.metadata?.type
      }))
    });

    if (newComments.length > 0) {
      this.logger.info('Found new comments for processing', {
        taskId: item.id,
        commentCount: newComments.length
      });
      await this.handleNewComments(item, prUrl, newComments);
    } else {
      this.logger.debug('No new comments found since last sync', {
        taskId: item.id,
        lastSyncTime: since.toISOString()
      });
    }
  }

  /**
   * 새로운 코멘트 처리
   */
  private async handleNewComments(item: any, prUrl: string, newComments: PullRequestComment[]): Promise<void> {
    this.logger.info('Processing new comments', {
      taskId: item.id,
      commentCount: newComments.length
    });

    // Manager에게 피드백 전달
    const request: TaskRequest = {
      taskId: item.id,
      action: TaskAction.PROCESS_FEEDBACK,
      pullRequestUrl: prUrl,
      boardItem: item,
      comments: newComments
    };

    const response = await this.dependencies.managerCommunicator.sendTaskToManager(request);

    if (response.status === ResponseStatus.ACCEPTED) {
      // 처리된 코멘트로 기록 (Task별 관리)
      const commentIds = newComments.map((comment: PullRequestComment) => comment.id);
      await this.dependencies.stateManager.addProcessedCommentsToTask(item.id, commentIds);
      
      // 작업별 lastSyncTime 업데이트
      const currentTime = new Date();
      await this.dependencies.stateManager.updateTaskLastSyncTime(item.id, currentTime);
      
      this.logger.info('Feedback processed', {
        taskId: item.id,
        commentCount: newComments.length,
        updatedLastSyncTime: currentTime.toISOString()
      });
    } else if (response.status === ResponseStatus.COMPLETED && response.pullRequestUrl) {
      // 피드백 처리 완료 시 새로운 PR URL 추가
      await this.dependencies.projectBoardService.addPullRequestToItem(item.id, response.pullRequestUrl);
      
      // 처리된 코멘트로 기록
      const commentIds = newComments.map((comment: PullRequestComment) => comment.id);
      await this.dependencies.stateManager.addProcessedCommentsToTask(item.id, commentIds);
      
      // 작업별 lastSyncTime 업데이트
      const currentTime = new Date();
      await this.dependencies.stateManager.updateTaskLastSyncTime(item.id, currentTime);
      
      this.logger.info('Feedback processing completed with new PR', {
        taskId: item.id,
        newPullRequestUrl: response.pullRequestUrl,
        updatedLastSyncTime: currentTime.toISOString()
      });
    } else if (response.status === ResponseStatus.ERROR) {
      this.logger.error('Feedback processing failed', {
        taskId: item.id,
        reason: response.message
      });
      this.errorManager.addError(
        'FEEDBACK_PROCESSING_ERROR', 
        response.message || 'Feedback processing failed', 
        { taskId: item.id }
      );
    }
  }

  /**
   * Worker 해제 요청
   */
  private async releaseWorker(taskId: string): Promise<void> {
    try {
      const request: TaskRequest = {
        taskId,
        action: TaskAction.RELEASE_WORKER
      };

      const response = await this.dependencies.managerCommunicator.sendTaskToManager(request);
      
      if (response.status === ResponseStatus.ACCEPTED) {
        this.logger.info('Worker released successfully', { taskId });
      } else {
        this.logger.warn('Worker release request failed', { 
          taskId, 
          status: response.status,
          message: response.message 
        });
      }
    } catch (error) {
      this.logger.error('Failed to release worker', {
        taskId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * PR URL 파싱
   */
  private parsePullRequestUrl(prUrl: string): { repoId: string; prNumber: number } {
    // URL 형식: https://github.com/owner/repo/pull/123
    const match = prUrl.match(/github\.com\/([^\/]+\/[^\/]+)\/pull\/(\d+)/);
    if (!match || !match[1] || !match[2]) {
      throw new Error(`Invalid PR URL format: ${prUrl}`);
    }
    
    return {
      repoId: match[1],
      prNumber: parseInt(match[2], 10)
    };
  }
}
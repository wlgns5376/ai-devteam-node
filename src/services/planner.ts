import { 
  PlannerServiceConfig, 
  PlannerStatus, 
  PlannerError, 
  PlannerService,
  PlannerDependencies,
  WorkflowState,
  TaskAction,
  TaskRequest,
  ResponseStatus,
  TaskInfo,
  PullRequestComment
} from '@/types';

export class Planner implements PlannerService {
  private monitoringTimer: NodeJS.Timeout | undefined;
  private workflowState: WorkflowState;
  private errors: PlannerError[] = [];
  private totalTasksProcessed = 0;

  constructor(
    private readonly config: PlannerServiceConfig,
    private readonly dependencies: PlannerDependencies
  ) {
    this.workflowState = {
      processedTasks: new Set(),
      processedComments: new Set(),
      activeTasks: new Map()
    };
  }

  async startMonitoring(): Promise<void> {
    if (this.monitoringTimer) {
      return; // 이미 모니터링 중
    }

    this.dependencies.logger.info('Planner monitoring started', {
      boardId: this.config.boardId,
      interval: this.config.monitoringIntervalMs
    });

    this.monitoringTimer = setInterval(
      () => this.processWorkflowCycle(),
      this.config.monitoringIntervalMs
    );
  }

  async stopMonitoring(): Promise<void> {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = undefined;
      
      this.dependencies.logger.info('Planner monitoring stopped');
    }
  }

  isRunning(): boolean {
    return this.monitoringTimer !== undefined;
  }

  getStatus(): PlannerStatus {
    return {
      isRunning: this.isRunning(),
      lastSyncTime: this.workflowState.lastSyncTime,
      totalTasksProcessed: this.totalTasksProcessed,
      activeTasks: this.workflowState.activeTasks.size,
      errors: [...this.errors]
    };
  }

  async forceSync(): Promise<void> {
    await this.processWorkflowCycle();
  }

  async processWorkflowCycle(): Promise<void> {
    try {
      this.dependencies.logger.debug('Starting workflow cycle');

      await this.handleNewTasks();
      await this.handleInProgressTasks();  
      await this.handleReviewTasks();

      this.workflowState.lastSyncTime = new Date();
      
      this.dependencies.logger.debug('Workflow cycle completed', {
        lastSyncTime: this.workflowState.lastSyncTime,
        activeTasks: this.workflowState.activeTasks.size
      });

    } catch (error) {
      const plannerError: PlannerError = {
        message: error instanceof Error ? error.message : 'Unknown workflow error',
        code: 'WORKFLOW_CYCLE_ERROR',
        timestamp: new Date(),
        context: { error }
      };
      
      this.errors.push(plannerError);
      
      this.dependencies.logger.error('Workflow cycle error', {
        error: plannerError
      });
    }
  }

  async handleNewTasks(): Promise<void> {
    try {
      // 1. 프로젝트 보드에서 TODO 상태 작업 조회
      const todoItems = await this.dependencies.projectBoardService.getItems(
        this.config.boardId, 
        'TODO'
      );

      for (const item of todoItems) {
        if (!this.workflowState.processedTasks.has(item.id)) {
          try {
            // 2. Manager에게 작업 전달
            const request: TaskRequest = {
              taskId: item.id,
              action: TaskAction.START_NEW_TASK,
              boardItem: item
            };

            const response = await this.dependencies.managerCommunicator.sendTaskToManager(request);

            if (response.status === ResponseStatus.ACCEPTED) {
              // 3. 작업 상태를 IN_PROGRESS로 변경
              await this.dependencies.projectBoardService.updateItemStatus(item.id, 'IN_PROGRESS');
              
              // 처리된 작업으로 기록
              this.workflowState.processedTasks.add(item.id);
              this.workflowState.activeTasks.set(item.id, {
                taskId: item.id,
                status: 'IN_PROGRESS',
                startedAt: new Date(),
                lastUpdatedAt: new Date()
              });
              
              this.totalTasksProcessed++;
              
              this.dependencies.logger.info('New task started', {
                taskId: item.id,
                title: item.title
              });
            } else {
              this.dependencies.logger.warn('Task rejected by manager', {
                taskId: item.id,
                reason: response.message
              });
            }
          } catch (error) {
            this.addError('TASK_START_ERROR', `Failed to start task ${item.id}`, { error, taskId: item.id });
          }
        }
      }
    } catch (error) {
      this.addError('NEW_TASKS_ERROR', 'Failed to handle new tasks', { error });
    }
  }

  async handleInProgressTasks(): Promise<void> {
    try {
      // 1. 프로젝트 보드에서 In Progress 작업 조회
      const inProgressItems = await this.dependencies.projectBoardService.getItems(
        this.config.boardId,
        'IN_PROGRESS'
      );

      for (const item of inProgressItems) {
        try {
          // 2. Manager에게 작업 상태 확인
          const request: TaskRequest = {
            taskId: item.id,
            action: TaskAction.CHECK_STATUS
          };

          const response = await this.dependencies.managerCommunicator.sendTaskToManager(request);

          if (response.status === ResponseStatus.COMPLETED && response.pullRequestUrl) {
            // 3. 작업 완료 시 IN_REVIEW로 변경하고 PR 링크 등록
            await this.dependencies.projectBoardService.updateItemStatus(item.id, 'IN_REVIEW');
            await this.dependencies.projectBoardService.addPullRequestToItem(item.id, response.pullRequestUrl);
            
            // 활성 작업 상태 업데이트
            const taskInfo = this.workflowState.activeTasks.get(item.id);
            if (taskInfo) {
              this.workflowState.activeTasks.set(item.id, {
                ...taskInfo,
                status: 'IN_REVIEW',
                lastUpdatedAt: new Date()
              });
            }
            
            this.dependencies.logger.info('Task moved to review', {
              taskId: item.id,
              pullRequestUrl: response.pullRequestUrl
            });
          } else if (response.status === ResponseStatus.ERROR) {
            this.addError('WORKER_ERROR', `Worker error for task ${item.id}`, {
              taskId: item.id,
              message: response.message
            });
          }
        } catch (error) {
          this.addError('TASK_STATUS_CHECK_ERROR', `Failed to check status for task ${item.id}`, { error, taskId: item.id });
        }
      }
    } catch (error) {
      this.addError('IN_PROGRESS_TASKS_ERROR', 'Failed to handle in-progress tasks', { error });
    }
  }

  async handleReviewTasks(): Promise<void> {
    try {
      // 1. 프로젝트 보드에서 In Review 작업 조회
      const reviewItems = await this.dependencies.projectBoardService.getItems(
        this.config.boardId,
        'IN_REVIEW'
      );

      for (const item of reviewItems) {
        if (item.pullRequestUrls.length > 0) {
          try {
            const prUrl = item.pullRequestUrls[0];
            const { repoId, prNumber } = this.parsePullRequestUrl(prUrl);

            // 2. PR 상태 확인
            const pr = await this.dependencies.pullRequestService.getPullRequest(repoId, prNumber);

            if (pr.status === 'merged') {
              // 승인됨 -> 완료로 변경
              await this.dependencies.projectBoardService.updateItemStatus(item.id, 'DONE');
              
              // 완료된 작업을 활성 작업에서 제거
              this.workflowState.activeTasks.delete(item.id);
              
              this.dependencies.logger.info('Task completed', {
                taskId: item.id,
                prUrl
              });
            } else {
              // 3. 신규 코멘트 확인
              const since = this.workflowState.lastSyncTime || new Date(Date.now() - 24 * 60 * 60 * 1000);
              const newComments = await this.dependencies.pullRequestService.getNewComments(repoId, prNumber, since);

              if (newComments.length > 0) {
                // 4. Manager에게 피드백 전달
                const request: TaskRequest = {
                  taskId: item.id,
                  action: TaskAction.PROCESS_FEEDBACK,
                  comments: newComments
                };

                const response = await this.dependencies.managerCommunicator.sendTaskToManager(request);

                if (response.status === ResponseStatus.ACCEPTED) {
                  // 처리된 코멘트로 기록
                  const commentIds = newComments.map((comment: PullRequestComment) => comment.id);
                  commentIds.forEach((id: string) => this.workflowState.processedComments.add(id));
                  
                  this.dependencies.logger.info('Feedback processed', {
                    taskId: item.id,
                    commentCount: newComments.length
                  });
                }
              }
            }
          } catch (error) {
            this.addError('REVIEW_TASK_ERROR', `Failed to handle review task ${item.id}`, { error, taskId: item.id });
          }
        }
      }
    } catch (error) {
      this.addError('REVIEW_TASKS_ERROR', 'Failed to handle review tasks', { error });
    }
  }

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

  private addError(code: string, message: string, context?: Record<string, unknown>): void {
    const error: PlannerError = {
      message,
      code,
      timestamp: new Date(),
      context
    };
    
    this.errors.push(error);
    
    // 에러 개수 제한 (최대 100개)
    if (this.errors.length > 100) {
      this.errors = this.errors.slice(-50);
    }
  }
}
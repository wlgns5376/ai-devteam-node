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

    // 모니터링 시작 전 기존 작업 상태 복원
    await this.initializeWorkflowState();

    this.dependencies.logger.info('Planner monitoring started', {
      boardId: this.config.boardId,
      interval: this.config.monitoringIntervalMs,
      restoredProcessedTasks: this.workflowState.processedTasks.size,
      restoredActiveTasks: this.workflowState.activeTasks.size
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

  /**
   * 시작 시 기존 프로젝트 보드 상태를 기반으로 워크플로우 상태를 초기화
   */
  private async initializeWorkflowState(): Promise<void> {
    try {
      this.dependencies.logger.debug('Initializing workflow state from project board');

      // 모든 상태의 작업 조회
      const [todoItems, inProgressItems, inReviewItems, doneItems] = await Promise.all([
        this.dependencies.projectBoardService.getItems(this.config.boardId, 'TODO'),
        this.dependencies.projectBoardService.getItems(this.config.boardId, 'IN_PROGRESS'),
        this.dependencies.projectBoardService.getItems(this.config.boardId, 'IN_REVIEW'),
        this.dependencies.projectBoardService.getItems(this.config.boardId, 'DONE')
      ]);

      const now = new Date();

      // DONE 상태 작업들을 처리된 작업으로 기록
      for (const item of doneItems) {
        this.workflowState.processedTasks.add(item.id);
        this.dependencies.logger.debug('Restored completed task', {
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
          startedAt: now, // 정확한 시작 시간은 알 수 없으므로 현재 시간 사용
          lastUpdatedAt: now
        });
        this.dependencies.logger.debug('Restored active task', {
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
        this.dependencies.logger.debug('Restored review task', {
          taskId: item.id,
          title: item.title,
          status: 'IN_REVIEW'
        });
      }

      this.dependencies.logger.info('Workflow state initialized successfully', {
        totalProcessedTasks: this.workflowState.processedTasks.size,
        totalActiveTasks: this.workflowState.activeTasks.size,
        todoItemsCount: todoItems.length,
        inProgressItemsCount: inProgressItems.length,
        inReviewItemsCount: inReviewItems.length,
        doneItemsCount: doneItems.length
      });

    } catch (error) {
      this.dependencies.logger.error('Failed to initialize workflow state', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      
      this.addError('WORKFLOW_INIT_ERROR', 'Failed to initialize workflow state', { error });
    }
  }

  async processWorkflowCycle(): Promise<void> {
    try {
      this.dependencies.logger.debug('Starting workflow cycle');

      await this.handleNewTasks();
      await this.handleInProgressTasks();  
      await this.handleReviewTasks();

      // StateManager에 lastSyncTime 저장
      const now = new Date();
      await this.dependencies.stateManager.updateLastSyncTime(now);
      this.workflowState.lastSyncTime = now;
      
      this.dependencies.logger.debug('Workflow cycle completed', {
        lastSyncTime: now,
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

      this.dependencies.logger.debug('Retrieved TODO items for processing', {
        totalTodoItems: todoItems.length,
        processedTasksCount: this.workflowState.processedTasks.size,
        activeTasksCount: this.workflowState.activeTasks.size
      });

      for (const item of todoItems) {
        // TODO로 돌아온 작업은 다시 처리할 수 있도록 processedTasks에서 제거
        if (this.workflowState.processedTasks.has(item.id)) {
          this.dependencies.logger.info('Removing previously processed task from processed list for reprocessing', {
            taskId: item.id,
            title: item.title
          });
          this.workflowState.processedTasks.delete(item.id);
          this.workflowState.activeTasks.delete(item.id);
        }

        // 현재 활성 작업인지 확인
        if (this.workflowState.activeTasks.has(item.id)) {
          this.dependencies.logger.debug('Skipping currently active task', {
            taskId: item.id,
            title: item.title,
            activeStatus: this.workflowState.activeTasks.get(item.id)?.status
          });
          continue;
        }

        try {
          this.dependencies.logger.info('Processing new task', {
            taskId: item.id,
            title: item.title,
            status: item.status
          });

          // 2. Manager에게 작업 전달
          const request: TaskRequest = {
            taskId: item.id,
            action: TaskAction.START_NEW_TASK,
            boardItem: item
          };

          const response = await this.dependencies.managerCommunicator.sendTaskToManager(request);

          if (response.status === ResponseStatus.ACCEPTED) {
            this.dependencies.logger.info('Task accepted by manager, updating status to IN_PROGRESS', {
              taskId: item.id,
              title: item.title
            });

            // 3. 작업 상태를 IN_PROGRESS로 변경
            const updatedItem = await this.dependencies.projectBoardService.updateItemStatus(item.id, 'IN_PROGRESS');
            
            // 상태 변경 검증
            if (updatedItem.status !== 'IN_PROGRESS') {
              this.dependencies.logger.error('Status update failed - item status mismatch', {
                taskId: item.id,
                expectedStatus: 'IN_PROGRESS',
                actualStatus: updatedItem.status,
                title: item.title
              });
              
              this.addError('STATUS_UPDATE_FAILED', `Failed to update task ${item.id} status to IN_PROGRESS`, { 
                taskId: item.id, 
                expectedStatus: 'IN_PROGRESS',
                actualStatus: updatedItem.status
              });
              continue;
            }
            
            // 처리된 작업으로 기록
            this.workflowState.processedTasks.add(item.id);
            this.workflowState.activeTasks.set(item.id, {
              taskId: item.id,
              status: 'IN_PROGRESS',
              startedAt: new Date(),
              lastUpdatedAt: new Date()
            });
            
            this.totalTasksProcessed++;
            
            this.dependencies.logger.info('New task started successfully', {
              taskId: item.id,
              title: item.title,
              verifiedStatus: updatedItem.status
            });
          } else {
            this.dependencies.logger.warn('Task rejected by manager', {
              taskId: item.id,
              title: item.title,
              reason: response.message,
              responseStatus: response.status
            });
            
            // 거부된 작업도 처리된 것으로 기록하여 재시도 방지
            this.workflowState.processedTasks.add(item.id);
          }
        } catch (error) {
          this.dependencies.logger.error('Failed to process new task', {
            taskId: item.id,
            title: item.title,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
          });
          
          this.addError('TASK_START_ERROR', `Failed to start task ${item.id}`, { error, taskId: item.id });
        }
      }
    } catch (error) {
      this.dependencies.logger.error('Failed to handle new tasks', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      
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
            // 3. 작업 완료 시 IN_REVIEW로 변경
            await this.dependencies.projectBoardService.updateItemStatus(item.id, 'IN_REVIEW');
            
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
          } else if (response.status === ResponseStatus.COMPLETED && response.message === 'merged') {
            // 병합 완료 시 DONE으로 변경
            await this.dependencies.projectBoardService.updateItemStatus(item.id, 'DONE');
            
            // 완료된 작업을 활성 작업에서 제거
            this.workflowState.activeTasks.delete(item.id);
            
            this.dependencies.logger.info('Task completed after merge', {
              taskId: item.id
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

      this.dependencies.logger.debug('Handling review tasks', {
        boardId: this.config.boardId,
        reviewItemsCount: reviewItems.length
      });

      for (const item of reviewItems) {
        this.dependencies.logger.debug('Processing review item', {
          taskId: item.id,
          title: item.title,
          pullRequestUrls: item.pullRequestUrls
        });
        
        if (item.pullRequestUrls.length > 0) {
          try {
            const prUrl = item.pullRequestUrls[0];
            this.dependencies.logger.debug('Parsing PR URL', { taskId: item.id, prUrl });
            const { repoId, prNumber } = this.parsePullRequestUrl(prUrl);
            
            this.dependencies.logger.debug('Checking PR status', { taskId: item.id, repoId, prNumber });

            // 2. PR 상태 확인
            const pr = await this.dependencies.pullRequestService.getPullRequest(repoId, prNumber);
            
            this.dependencies.logger.debug('PR status retrieved', { 
              taskId: item.id, 
              prStatus: pr.status,
              prCreatedAt: pr.createdAt 
            });

            if (pr.status === 'merged') {
              // 이미 병합됨 -> 완료로 변경
              await this.dependencies.projectBoardService.updateItemStatus(item.id, 'DONE');
              
              // 완료된 작업을 활성 작업에서 제거
              this.workflowState.activeTasks.delete(item.id);
              
              this.dependencies.logger.info('Task completed (already merged)', {
                taskId: item.id,
                prUrl
              });
            } else {
              // 3. PR 승인 상태 확인
              this.dependencies.logger.debug('Checking PR approval status', { taskId: item.id, repoId, prNumber });
              const isApproved = await this.dependencies.pullRequestService.isApproved(repoId, prNumber);
              this.dependencies.logger.debug('PR approval status checked', { taskId: item.id, isApproved });
              
              if (isApproved) {
                // 승인됨 -> Manager에게 병합 요청
                const request: TaskRequest = {
                  taskId: item.id,
                  action: TaskAction.REQUEST_MERGE,
                  pullRequestUrl: prUrl
                };

                const response = await this.dependencies.managerCommunicator.sendTaskToManager(request);

                if (response.status === ResponseStatus.ACCEPTED) {
                  this.dependencies.logger.info('Merge request sent to manager', {
                    taskId: item.id,
                    prUrl
                  });
                } else {
                  this.dependencies.logger.warn('Merge request rejected by manager', {
                    taskId: item.id,
                    reason: response.message
                  });
                }
              } else {
                // 4. 미승인 - 신규 코멘트 확인
                // StateManager에서 lastSyncTime 가져오기 (없으면 7일 전부터 확인)
                const plannerState = await this.dependencies.stateManager.getPlannerState();
                const since = plannerState.lastSyncTime || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                this.dependencies.logger.debug('Checking for new comments', { 
                  taskId: item.id, 
                  since, 
                  lastSyncTime: plannerState.lastSyncTime,
                  repoId, 
                  prNumber 
                });
                
                // 모든 코멘트 확인 (디버깅용)
                const allComments = await this.dependencies.pullRequestService.getComments(repoId, prNumber);
                this.dependencies.logger.debug('All comments retrieved for debugging', {
                  taskId: item.id,
                  allCommentsCount: allComments.length,
                  allCommentDetails: allComments.map((c: any) => ({
                    id: c.id,
                    author: c.author,
                    createdAt: c.createdAt,
                    content: c.content.substring(0, 50) + (c.content.length > 50 ? '...' : '')
                  }))
                });
                
                // 설정에서 필터링 옵션 가져오기 (환경변수 우선)
                const filterOptions = this.config.pullRequestFilter || {
                  excludeAuthor: true, // 기본값
                };
                const newComments = await this.dependencies.pullRequestService.getNewComments(repoId, prNumber, since, filterOptions);
                
                // 필터링 전후 비교를 위해 전체 코멘트도 조회
                const allNewCommentsUnfiltered = await this.dependencies.pullRequestService.getNewComments(repoId, prNumber, since, { excludeAuthor: false });
                
                this.dependencies.logger.debug('New comments checked with filtering', { 
                  taskId: item.id, 
                  totalNewComments: allNewCommentsUnfiltered.length,
                  filteredNewComments: newComments.length,
                  filteredOut: allNewCommentsUnfiltered.length - newComments.length,
                  commentDetails: newComments.map((c: any) => ({
                    id: c.id,
                    author: c.author,
                    createdAt: c.createdAt,
                    content: c.content.substring(0, 100) + (c.content.length > 100 ? '...' : '')
                  }))
                });

                if (newComments.length > 0) {
                  // 5. Manager에게 피드백 전달
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
                    
                    this.dependencies.logger.info('Feedback processed', {
                      taskId: item.id,
                      commentCount: newComments.length
                    });
                  }
                }
              }
            }
          } catch (error) {
            this.dependencies.logger.error('Review task processing error', {
              taskId: item.id,
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined
            });
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
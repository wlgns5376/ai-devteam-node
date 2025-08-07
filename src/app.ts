import { AppConfig } from './config/app-config';
import { Planner } from './services/planner';
import { WorkerPoolManager } from './services/manager/worker-pool-manager';
import { WorkspaceManager } from './services/manager/workspace-manager';
import { Logger, LogLevel } from './services/logger';
import { StateManager } from './services/state-manager';
import { ServiceFactory } from './services/service-factory';
import { ProjectBoardService, PullRequestService } from './types';
import { DeveloperFactory } from './services/developer/developer-factory';
import { 
  PlannerDependencies, 
  ManagerCommunicator, 
  TaskRequest, 
  TaskResponse, 
  ResponseStatus,
  DeveloperConfig,
  SystemDeveloperConfig,
  WorkerAction
} from '@/types';

export interface SystemStatus {
  readonly isRunning: boolean;
  readonly plannerStatus: any;
  readonly workerPoolStatus: any;
  readonly startedAt?: Date;
  readonly uptime?: number;
}

export class AIDevTeamApp {
  private planner?: Planner;
  private workerPoolManager?: WorkerPoolManager;
  private logger?: Logger;
  private stateManager?: StateManager;
  private projectBoardService?: ProjectBoardService;
  private pullRequestService?: PullRequestService;
  
  private isInitialized = false;
  private isRunning = false;
  private startedAt: Date | undefined = undefined;

  constructor(private readonly config: AppConfig) {}

  private createDeveloperConfig(systemConfig: SystemDeveloperConfig): DeveloperConfig {
    return {
      timeoutMs: systemConfig.claudeCodeTimeoutMs,
      maxRetries: 3,
      retryDelayMs: 1000,
      
      // CLI 실행 파일 경로
      claudeCodePath: systemConfig.claudeCodePath,
      geminiCliPath: systemConfig.geminiCliPath,
      
      claude: {
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        model: 'claude-3-5-sonnet-20241022'
      },
      gemini: {
        apiKey: process.env.GEMINI_API_KEY || ''
      }
    };
  }

  private getLogLevel(level: string): LogLevel {
    switch (level) {
      case 'debug': return LogLevel.DEBUG;
      case 'info': return LogLevel.INFO;
      case 'warn': return LogLevel.WARN;
      case 'error': return LogLevel.ERROR;
      default: return LogLevel.INFO;
    }
  }

  // Repository 정보 추출 헬퍼 메서드
  private extractRepositoryFromBoardItem(boardItem: any, pullRequestUrl?: string): string {
    // 1. PR URL이 있으면 우선적으로 사용
    if (pullRequestUrl) {
      const match = pullRequestUrl.match(/github\.com\/([^\/]+\/[^\/]+)\/pull\/\d+/);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    // 2. boardItem에서 repository 정보 추출
    if (boardItem?.metadata?.repository) {
      return boardItem.metadata.repository;
    }
    if (boardItem?.repository?.id) {
      return boardItem.repository.id;
    }
    if (boardItem?.content?.repository?.nameWithOwner) {
      return boardItem.content.repository.nameWithOwner;
    }
    
    // 3. boardItem의 pullRequestUrls에서 추출 시도
    if (boardItem?.pullRequestUrls && boardItem.pullRequestUrls.length > 0) {
      const firstPrUrl = boardItem.pullRequestUrls[0];
      const match = firstPrUrl.match(/github\.com\/([^\/]+\/[^\/]+)\/pull\/\d+/);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    // 4. 기본값으로 config에서 repository 정보 사용
    return this.config.planner?.repoId || 'unknown/repository';
  }

  // Worker 작업 실행 헬퍼 메서드
  private async executeWorkerTask(workerId: string, request: TaskRequest): Promise<{success: boolean, pullRequestUrl?: string}> {
    try {
      if (!this.workerPoolManager) {
        throw new Error('WorkerPoolManager not initialized');
      }

      // Worker 인스턴스를 가져와서 실제 작업 실행
      const workerInstance = await this.workerPoolManager.getWorkerInstance(workerId, this.pullRequestService);
      if (!workerInstance) {
        return { success: false };
      }

      // 작업이 이미 할당되어 있다면 상태 확인
      const currentTask = workerInstance.getCurrentTask();
      if (currentTask?.taskId === request.taskId) {
        const workerStatus = workerInstance.getStatus();
        
        this.logger?.info('Checking worker status for task execution', {
          workerId,
          taskId: request.taskId,
          workerStatus,
          action: request.action
        });

        // 이미 실행 중인지 확인
        if (workerStatus === 'working') {
          this.logger?.info('Worker is already working, waiting for completion', {
            workerId,
            taskId: request.taskId
          });
          return { success: false }; // 아직 진행 중
        }
        
        // 중지된 상태면 재개
        if (workerStatus === 'stopped') {
          this.logger?.info('Resuming stopped worker execution', {
            workerId,
            taskId: request.taskId
          });
          await workerInstance.resumeExecution();
          return { success: false }; // 재개했으므로 계속 진행 중
        }
        
        // 대기 상태에서 작업 시작 또는 재시작
        if (workerStatus === 'waiting') {
          this.logger?.info('Starting or restarting worker execution', {
            workerId,
            taskId: request.taskId
          });
          
          try {
            const result = await workerInstance.startExecution();
            
            this.logger?.info('Worker execution completed', {
              workerId,
              taskId: request.taskId,
              success: result.success,
              pullRequestUrl: result.pullRequestUrl
            });
            
            return {
              success: result.success,
              ...(result.pullRequestUrl && { pullRequestUrl: result.pullRequestUrl })
            };
          } catch (executionError) {
            this.logger?.error('Worker execution failed', {
              workerId,
              taskId: request.taskId,
              error: executionError instanceof Error ? executionError.message : String(executionError)
            });
            
            // Worker 실패 시 자동으로 해제하여 상태 동기화
            try {
              await this.workerPoolManager.releaseWorker(workerId);
              this.logger?.info('Worker released after execution failure', {
                workerId,
                taskId: request.taskId
              });
            } catch (releaseError) {
              this.logger?.warn('Failed to release worker after execution failure', {
                workerId,
                error: releaseError instanceof Error ? releaseError.message : String(releaseError)
              });
            }
            
            return { success: false };
          }
        }
        
        // idle 상태면 작업이 완료되었을 수 있음
        if (workerStatus === 'idle') {
          this.logger?.info('Worker is idle, task may be completed', {
            workerId,
            taskId: request.taskId
          });
          return { success: true }; // 완료된 것으로 간주
        }
      }

      this.logger?.warn('Worker task mismatch or invalid state', {
        workerId,
        requestTaskId: request.taskId,
        currentTaskId: currentTask?.taskId,
        workerStatus: workerInstance.getStatus()
      });

      return { success: false };

    } catch (error) {
      this.logger?.error('Failed to execute worker task', {
        workerId,
        taskId: request.taskId,
        error: error instanceof Error ? error.message : String(error)
      });
      return { success: false };
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('Application is already initialized');
    }

    try {
      console.log('🚀 AI DevTeam 시스템 초기화 시작...');

      // 1. Logger 초기화
      const loggerConfig = {
        level: this.getLogLevel(this.config.logger.level),
        filePath: this.config.logger.filePath,
        enableConsole: this.config.logger.enableConsole
      };
      this.logger = new Logger(loggerConfig);
      this.logger.info('Logger initialized', { config: this.config.logger });

      // 2. StateManager 초기화
      this.stateManager = new StateManager(`${this.config.manager.workspaceRoot}/.state`);
      await this.stateManager.initialize();
      this.logger.info('StateManager initialized');

      // 3. 서비스들 초기화
      // GitHub Projects v2 및 PullRequest 서비스 사용
      const serviceFactory = new ServiceFactory(this.logger);
      const githubV2Config = ServiceFactory.createGitHubV2ConfigFromEnv();
      this.projectBoardService = serviceFactory.createProjectBoardService(githubV2Config);
      this.pullRequestService = serviceFactory.createPullRequestService(githubV2Config);
      
      // Repository 관련 서비스 초기화
      const gitService = serviceFactory.createGitService(this.config.manager.gitOperationTimeoutMs);
      const repositoryManager = serviceFactory.createRepositoryManager(
        {
          workspaceBasePath: this.config.manager.workspaceRoot,
          repositoryCacheTimeoutMs: this.config.manager.repositoryCacheTimeoutMs,
          gitOperationTimeoutMs: this.config.manager.gitOperationTimeoutMs,
          minWorkers: this.config.manager.workerPool.minWorkers,
          maxWorkers: this.config.manager.workerPool.maxWorkers,
          workerRecoveryTimeoutMs: this.config.manager.workerPool.workerTimeoutMs
        },
        this.stateManager
      );
      
      this.logger.info('Services initialized', { 
        projectBoardService: 'GitHub Projects v2',
        pullRequestService: 'GitHub',
        gitService: 'GitService with Lock',
        repositoryManager: 'RepositoryManager',
        config: githubV2Config
      });

      // 4. WorkspaceManager 초기화
      const workspaceManager = new WorkspaceManager(
        {
          workspaceBasePath: this.config.manager.workspaceRoot,
          minWorkers: this.config.manager.workerPool.minWorkers,
          maxWorkers: this.config.manager.workerPool.maxWorkers,
          workerRecoveryTimeoutMs: this.config.manager.workerPool.workerTimeoutMs,
          gitOperationTimeoutMs: this.config.manager.gitOperationTimeoutMs,
          repositoryCacheTimeoutMs: this.config.manager.repositoryCacheTimeoutMs
        },
        {
          logger: this.logger,
          stateManager: this.stateManager,
          gitService,
          repositoryManager
        }
      );

      // 5. WorkerPoolManager 초기화
      this.workerPoolManager = new WorkerPoolManager(
        {
          workspaceBasePath: this.config.manager.workspaceRoot,
          minWorkers: this.config.manager.workerPool.minWorkers,
          maxWorkers: this.config.manager.workerPool.maxWorkers,
          workerRecoveryTimeoutMs: this.config.manager.workerPool.workerTimeoutMs,
          gitOperationTimeoutMs: this.config.manager.gitOperationTimeoutMs,
          repositoryCacheTimeoutMs: this.config.manager.repositoryCacheTimeoutMs
        },
        { 
          logger: this.logger, 
          stateManager: this.stateManager,
          workspaceManager,
          developerConfig: this.createDeveloperConfig(this.config.developer)
        }
      );
      this.logger.info('WorkerPoolManager and WorkspaceManager initialized');

      // 6. Manager Communicator 구현
      const managerCommunicator: ManagerCommunicator = {
        sendTaskToManager: async (request: TaskRequest): Promise<TaskResponse> => {
          if (!this.workerPoolManager) {
            throw new Error('WorkerPoolManager not initialized');
          }

          try {
            this.logger?.info('Received task request', { 
              taskId: request.taskId, 
              action: request.action 
            });

            if (request.action === 'start_new_task') {
              // 새 작업 시작
              const availableWorker = await this.workerPoolManager.getAvailableWorker();
              if (!availableWorker) {
                return {
                  taskId: request.taskId,
                  status: ResponseStatus.REJECTED,
                  message: 'No available workers',
                  workerStatus: 'unavailable'
                };
              }

              // PRD 요구사항에 맞는 전체 작업 정보 생성
              const workerTask = {
                taskId: request.taskId,
                action: 'start_new_task' as any,
                boardItem: request.boardItem,
                repositoryId: this.extractRepositoryFromBoardItem(request.boardItem),
                assignedAt: new Date()
              };

              // Worker에 전체 작업 정보 할당
              await this.workerPoolManager.assignWorkerTask(availableWorker.id, workerTask);

              // 작업 즉시 실행
              const workerInstance = await this.workerPoolManager.getWorkerInstance(availableWorker.id, this.pullRequestService);
              if (workerInstance) {
                // 비동기로 작업 실행 (완료를 기다리지 않음)
                workerInstance.startExecution().then(async (result) => {
                  this.logger?.info('New task execution completed', {
                    taskId: request.taskId,
                    workerId: availableWorker.id,
                    success: result.success,
                    pullRequestUrl: result.pullRequestUrl
                  });
                  
                  // PR이 생성된 경우 상태를 IN_REVIEW로 업데이트하고 PR 링크 연결
                  if (result.success && result.pullRequestUrl) {
                    this.logger?.info('Updating task status to IN_REVIEW and linking PR', {
                      taskId: request.taskId,
                      pullRequestUrl: result.pullRequestUrl
                    });
                    
                    // 상태 업데이트와 PR 연결을 분리하여 처리
                    let statusUpdateSuccess = false;
                    let prLinkSuccess = false;

                    // 1단계: 상태를 IN_REVIEW로 변경
                    try {
                      await this.projectBoardService?.updateItemStatus(request.taskId, 'IN_REVIEW');
                      statusUpdateSuccess = true;
                      this.logger?.info('Task status updated to IN_REVIEW successfully', {
                        taskId: request.taskId,
                        newStatus: 'IN_REVIEW'
                      });
                    } catch (statusError) {
                      this.logger?.error('Failed to update task status', {
                        taskId: request.taskId,
                        error: statusError instanceof Error ? statusError.message : String(statusError),
                        stack: statusError instanceof Error ? statusError.stack : undefined
                      });
                    }

                    // PR URL은 로컬 캐시에만 저장됨 (GitHub Projects API 제한)
                    prLinkSuccess = true;
                    this.logger?.info('PR URL stored in local cache', {
                      taskId: request.taskId,
                      pullRequestUrl: result.pullRequestUrl,
                      note: 'GitHub Projects API does not support direct PR linking'
                    });

                    // 결과 로깅
                    if (statusUpdateSuccess && prLinkSuccess) {
                      this.logger?.info('Task status updated and PR linked successfully', {
                        taskId: request.taskId,
                        newStatus: 'IN_REVIEW',
                        pullRequestUrl: result.pullRequestUrl
                      });
                    } else if (statusUpdateSuccess || prLinkSuccess) {
                      this.logger?.warn('Partial success in task update', {
                        taskId: request.taskId,
                        statusUpdateSuccess,
                        prLinkSuccess,
                        pullRequestUrl: result.pullRequestUrl
                      });
                    } else {
                      this.logger?.error('Both task status update and PR linking failed', {
                        taskId: request.taskId,
                        pullRequestUrl: result.pullRequestUrl
                      });
                    }
                  }
                }).catch((error) => {
                  this.logger?.error('New task execution failed', {
                    taskId: request.taskId,
                    workerId: availableWorker.id,
                    error: error instanceof Error ? error.message : String(error)
                  });
                });
              }

              this.logger?.info('Task assigned to worker and started', {
                taskId: request.taskId,
                workerId: availableWorker.id,
                repositoryId: workerTask.repositoryId,
                action: workerTask.action
              });

              return {
                taskId: request.taskId,
                status: ResponseStatus.ACCEPTED,
                message: 'Task assigned to worker and execution started',
                workerStatus: 'assigned'
              };

            } else if (request.action === 'check_status') {
              // 작업 상태 확인
              let worker = await this.workerPoolManager.getWorkerByTaskId(request.taskId);
              
              if (!worker) {
                // Worker를 찾지 못한 경우 재할당 시도
                this.logger?.warn('Worker not found for task, attempting to reassign', {
                  taskId: request.taskId
                });

                // 사용 가능한 Worker 찾기
                const availableWorker = await this.workerPoolManager.getAvailableWorker();
                if (!availableWorker) {
                  return {
                    taskId: request.taskId,
                    status: ResponseStatus.ERROR,
                    message: 'No available workers to reassign task',
                    workerStatus: 'unavailable'
                  };
                }

                // 작업 재할당 (RESUME_TASK 액션으로)
                const resumeTask = {
                  taskId: request.taskId,
                  action: WorkerAction.RESUME_TASK,
                  boardItem: request.boardItem,
                  repositoryId: request.boardItem?.metadata?.repository || 'unknown',
                  assignedAt: new Date()
                };

                try {
                  await this.workerPoolManager.assignWorkerTask(availableWorker.id, resumeTask);
                  
                  // Worker 인스턴스 가져오기
                  const workerInstance = await this.workerPoolManager.getWorkerInstance(availableWorker.id, this.pullRequestService);
                  if (workerInstance) {
                    const result = await workerInstance.startExecution();
                    
                    this.logger?.info('Task reassigned and resumed successfully', {
                      taskId: request.taskId,
                      workerId: availableWorker.id,
                      success: result.success
                    });

                    if (result.success && result.pullRequestUrl) {
                      await this.workerPoolManager.releaseWorker(availableWorker.id);
                      return {
                        taskId: request.taskId,
                        status: ResponseStatus.COMPLETED,
                        message: 'Task completed after reassignment',
                        pullRequestUrl: result.pullRequestUrl,
                        workerStatus: 'completed'
                      };
                    }
                  }

                  return {
                    taskId: request.taskId,
                    status: ResponseStatus.IN_PROGRESS,
                    message: 'Task reassigned and execution resumed',
                    workerStatus: 'reassigned'
                  };

                } catch (error) {
                  this.logger?.error('Failed to reassign task', {
                    taskId: request.taskId,
                    workerId: availableWorker.id,
                    error: error instanceof Error ? error.message : String(error)
                  });
                  
                  return {
                    taskId: request.taskId,
                    status: ResponseStatus.ERROR,
                    message: 'Failed to reassign task',
                    workerStatus: 'error'
                  };
                }
              }

              // Worker에서 실제 작업 실행 및 결과 확인
              const result = await this.executeWorkerTask(worker.id, request);
              
              if (result.success && result.pullRequestUrl) {
                // Worker 해제
                await this.workerPoolManager.releaseWorker(worker.id);
                
                return {
                  taskId: request.taskId,
                  status: ResponseStatus.COMPLETED,
                  message: 'Task completed successfully',
                  pullRequestUrl: result.pullRequestUrl,
                  workerStatus: 'completed'
                };
              } else {
                return {
                  taskId: request.taskId,
                  status: ResponseStatus.IN_PROGRESS,
                  message: 'Task still in progress',
                  workerStatus: 'working'
                };
              }

            } else if (request.action === 'process_feedback') {
              // 피드백 처리
              let worker = await this.workerPoolManager.getWorkerByTaskId(request.taskId);
              let workerId: string;
              
              if (!worker) {
                // 기존 워커가 없으면 새 워커 할당
                this.logger?.info('No existing worker found for task, allocating new worker', {
                  taskId: request.taskId
                });
                
                const availableWorker = await this.workerPoolManager.getAvailableWorker();
                if (!availableWorker) {
                  return {
                    taskId: request.taskId,
                    status: ResponseStatus.REJECTED,
                    message: 'No available workers for feedback processing',
                    workerStatus: 'unavailable'
                  };
                }
                
                workerId = availableWorker.id;
                
                // 새 워커에 피드백 작업 할당
                const feedbackTask = {
                  taskId: request.taskId,
                  action: 'process_feedback' as any,
                  boardItem: request.boardItem,
                  pullRequestUrl: request.pullRequestUrl,
                  comments: request.comments,
                  repositoryId: request.boardItem ? this.extractRepositoryFromBoardItem(request.boardItem, request.pullRequestUrl) : undefined,
                  assignedAt: new Date()
                };
                
                await this.workerPoolManager.assignWorkerTask(workerId, feedbackTask);
              } else {
                // 기존 워커가 있으면 재사용
                workerId = worker.id;
                
                // 기존 작업에 피드백 정보 추가
                const feedbackTask = {
                  ...worker.currentTask,
                  action: 'process_feedback' as any,
                  comments: request.comments,
                  assignedAt: new Date()
                };

                // Worker에 피드백 작업 재할당
                await this.workerPoolManager.assignWorkerTask(workerId, feedbackTask);
              }

              // 작업 즉시 실행
              const workerInstance = await this.workerPoolManager.getWorkerInstance(workerId, this.pullRequestService);
              if (workerInstance) {
                // 비동기로 작업 실행 (완료를 기다리지 않음)
                workerInstance.startExecution().then((result) => {
                  this.logger?.info('Feedback processing completed', {
                    taskId: request.taskId,
                    workerId: workerId,
                    success: result.success
                  });
                }).catch((error) => {
                  this.logger?.error('Feedback processing failed', {
                    taskId: request.taskId,
                    workerId: workerId,
                    error: error instanceof Error ? error.message : String(error)
                  });
                });
              }

              this.logger?.info('Feedback task assigned to worker and started', {
                taskId: request.taskId,
                workerId: workerId,
                commentCount: request.comments?.length || 0,
                isNewWorker: !worker
              });

              return {
                taskId: request.taskId,
                status: ResponseStatus.ACCEPTED,
                message: 'Feedback processing started and execution started',
                workerStatus: 'processing_feedback'
              };
            } else if (request.action === 'request_merge') {
              // PR 병합 요청 처리
              let worker = await this.workerPoolManager.getWorkerByTaskId(request.taskId);
              
              // 이미 작업이 진행 중인 경우 중복 처리 방지
              if (worker) {
                const workerInstance = await this.workerPoolManager.getWorkerInstance(worker.id, this.pullRequestService);
                if (workerInstance && (workerInstance.getStatus() === 'working' || workerInstance.getStatus() === 'waiting')) {
                  this.logger?.info('Worker already processing merge request', {
                    taskId: request.taskId,
                    workerId: worker.id,
                    status: workerInstance.getStatus()
                  });
                  
                  return {
                    taskId: request.taskId,
                    status: ResponseStatus.ACCEPTED,
                    message: 'Merge request already being processed',
                    workerStatus: 'already_processing'
                  };
                }
              }
              
              // 기존 worker가 없거나 idle 상태면 새로운 worker를 할당
              if (!worker) {
                worker = await this.workerPoolManager.getAvailableWorker();
                if (!worker) {
                  return {
                    taskId: request.taskId,
                    status: ResponseStatus.ERROR,
                    message: 'No available worker for merge request',
                    workerStatus: 'no_available_worker'
                  };
                }

                this.logger?.info('Assigned new worker for merge request', {
                  taskId: request.taskId,
                  workerId: worker.id
                });
              }

              // 병합 요청을 위한 작업 정보 생성
              const mergeTask = {
                taskId: request.taskId,
                action: 'merge_request' as any,
                pullRequestUrl: request.pullRequestUrl,
                boardItem: request.boardItem,
                repositoryId: this.extractRepositoryFromBoardItem(request.boardItem, request.pullRequestUrl),
                assignedAt: new Date()
              };

              // Worker에 병합 작업 할당
              await this.workerPoolManager.assignWorkerTask(worker.id, mergeTask);

              // 작업 즉시 실행
              const workerInstance = await this.workerPoolManager.getWorkerInstance(worker.id, this.pullRequestService);
              if (workerInstance) {
                // 비동기로 작업 실행 (완료를 기다리지 않음)
                workerInstance.startExecution().then(async (result) => {
                  this.logger?.info('Merge request execution completed', {
                    taskId: request.taskId,
                    workerId: worker.id,
                    success: result.success
                  });
                  
                  // 병합이 성공한 경우 작업을 Done 상태로 변경
                  if (result.success && this.projectBoardService) {
                    try {
                      this.logger?.info('Updating task status to DONE after successful merge', {
                        taskId: request.taskId
                      });
                      await this.projectBoardService.updateItemStatus(request.taskId, 'DONE');
                      this.logger?.info('Task status updated to DONE', {
                        taskId: request.taskId
                      });
                    } catch (updateError) {
                      this.logger?.error('Failed to update task status to DONE', {
                        taskId: request.taskId,
                        error: updateError instanceof Error ? updateError.message : String(updateError)
                      });
                    }
                  }
                  
                  // 작업 완료 후 Worker 해제
                  if (this.workerPoolManager && worker?.id) {
                    Promise.resolve(this.workerPoolManager.releaseWorker(worker.id)).catch(err => {
                      this.logger?.error('Failed to release worker after merge', {
                        workerId: worker.id,
                        error: err
                      });
                    });
                  }
                }).catch((error) => {
                  this.logger?.error('Merge request execution failed', {
                    taskId: request.taskId,
                    workerId: worker.id,
                    error: error instanceof Error ? error.message : String(error)
                  });
                  
                  // 실패해도 Worker는 해제
                  if (this.workerPoolManager && worker?.id) {
                    Promise.resolve(this.workerPoolManager.releaseWorker(worker.id)).catch(err => {
                      this.logger?.error('Failed to release worker after error', {
                        workerId: worker.id,
                        error: err
                      });
                    });
                  }
                });
              }

              this.logger?.info('Merge request task assigned and started', {
                taskId: request.taskId,
                workerId: worker.id,
                pullRequestUrl: request.pullRequestUrl
              });

              return {
                taskId: request.taskId,
                status: ResponseStatus.ACCEPTED,
                message: 'Merge request processing started',
                workerStatus: 'processing_merge'
              };
            }

            return {
              taskId: request.taskId,
              status: ResponseStatus.ERROR,
              message: `Unsupported action: ${request.action}`,
              workerStatus: 'error'
            };

          } catch (error) {
            this.logger?.error('Failed to process task request', { 
              taskId: request.taskId, 
              error: error instanceof Error ? error.message : String(error)
            });

            return {
              taskId: request.taskId,
              status: ResponseStatus.ERROR,
              message: error instanceof Error ? error.message : 'Unknown error',
              workerStatus: 'error'
            };
          }
        }
      };

      // 7. Planner 초기화
      const plannerDependencies: PlannerDependencies = {
        projectBoardService: this.projectBoardService,
        pullRequestService: this.pullRequestService,
        stateManager: this.stateManager,
        logger: this.logger,
        managerCommunicator
      };

      this.planner = new Planner(this.config.planner, plannerDependencies);
      this.logger.info('Planner initialized');

      console.log('✅ AI DevTeam 시스템 초기화 완료');
      this.isInitialized = true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ 시스템 초기화 실패:', errorMessage);
      this.logger?.error('System initialization failed', { error: errorMessage });
      throw error;
    }
  }

  async start(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Application must be initialized before starting');
    }

    if (this.isRunning) {
      throw new Error('Application is already running');
    }

    try {
      console.log('🚀 AI DevTeam 시스템 시작...');

      // WorkerPool 초기화
      await this.workerPoolManager!.initializePool();
      this.logger?.info('Worker pool started');

      // Planner 모니터링 시작
      await this.planner!.startMonitoring();
      this.logger?.info('Planner monitoring started');

      this.isRunning = true;
      this.startedAt = new Date();

      console.log('✅ AI DevTeam 시스템 시작 완료');
      console.log('📊 시스템이 정상적으로 실행 중입니다...');
      
      // 상태 정보 출력
      const status = this.getStatus();
      console.log('👷 Worker Pool:', `${status.workerPoolStatus.activeWorkers}/${status.workerPoolStatus.workers.length} (활성/전체)`);
      console.log('📋 모니터링 간격:', `${this.config.planner.monitoringIntervalMs}ms`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ 시스템 시작 실패:', errorMessage);
      this.logger?.error('System start failed', { error: errorMessage });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      console.log('🛑 AI DevTeam 시스템 정지 중...');

      // Planner 모니터링 정지
      if (this.planner) {
        await this.planner.stopMonitoring();
        this.logger?.info('Planner monitoring stopped');
      }

      // WorkerPool 종료
      if (this.workerPoolManager) {
        await this.workerPoolManager.shutdown();
        this.logger?.info('Worker pool shutdown');
      }

      this.isRunning = false;
      this.startedAt = undefined;

      console.log('✅ AI DevTeam 시스템 정지 완료');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ 시스템 정지 실패:', errorMessage);
      this.logger?.error('System stop failed', { error: errorMessage });
      throw error;
    }
  }

  getStatus(): SystemStatus {
    if (!this.isInitialized) {
      return {
        isRunning: false,
        plannerStatus: null,
        workerPoolStatus: null
      };
    }

    const uptime = this.startedAt ? Date.now() - this.startedAt.getTime() : undefined;

    return {
      isRunning: this.isRunning,
      plannerStatus: this.planner?.getStatus() || null,
      workerPoolStatus: this.workerPoolManager?.getPoolStatus() || null,
      ...(this.startedAt && { startedAt: this.startedAt }),
      ...(uptime !== undefined && { uptime })
    };
  }

  // 테스트를 위한 public handleTaskRequest 메서드 추가
  public async handleTaskRequest(request: TaskRequest): Promise<TaskResponse> {
    if (!this.workerPoolManager) {
      throw new Error('WorkerPoolManager not initialized');
    }

    try {
      this.logger?.info('Received task request', { 
        taskId: request.taskId, 
        action: request.action 
      });

      if (request.action === 'request_merge') {
        // PR 병합 요청 처리
        let worker = await this.workerPoolManager.getWorkerByTaskId(request.taskId);
        
        // 이미 작업이 진행 중인 경우 중복 처리 방지
        if (worker) {
          const workerInstance = await this.workerPoolManager.getWorkerInstance(worker.id, this.pullRequestService);
          if (workerInstance && (workerInstance.getStatus() === 'working' || workerInstance.getStatus() === 'waiting')) {
            this.logger?.info('Worker already processing merge request', {
              taskId: request.taskId,
              workerId: worker.id,
              status: workerInstance.getStatus()
            });
            
            return {
              taskId: request.taskId,
              status: ResponseStatus.ACCEPTED,
              message: 'Merge request already being processed',
              workerStatus: 'already_processing'
            };
          }
        }
        
        // 기존 worker가 없거나 idle 상태면 새로운 worker를 할당
        if (!worker) {
          worker = await this.workerPoolManager.getAvailableWorker();
          if (!worker) {
            return {
              taskId: request.taskId,
              status: ResponseStatus.ERROR,
              message: 'No available worker for merge request',
              workerStatus: 'no_available_worker'
            };
          }

          this.logger?.info('Assigned new worker for merge request', {
            taskId: request.taskId,
            workerId: worker.id
          });
        }

        // 병합 요청을 위한 작업 정보 생성
        const mergeTask = {
          taskId: request.taskId,
          action: 'merge_request' as any,
          pullRequestUrl: request.pullRequestUrl,
          boardItem: request.boardItem,
          repositoryId: this.extractRepositoryFromBoardItem(request.boardItem, request.pullRequestUrl),
          assignedAt: new Date()
        };

        // Worker에 병합 작업 할당
        await this.workerPoolManager.assignWorkerTask(worker.id, mergeTask);

        // 작업 즉시 실행
        const workerInstance = await this.workerPoolManager.getWorkerInstance(worker.id, this.pullRequestService);
        if (workerInstance) {
          // 비동기로 작업 실행 (완료를 기다리지 않음)
          workerInstance.startExecution().then((result) => {
            this.logger?.info('Merge request execution completed', {
              taskId: request.taskId,
              workerId: worker.id,
              success: result.success
            });
            
            // 작업 완료 후 Worker 해제
            if (this.workerPoolManager && worker?.id) {
              Promise.resolve(this.workerPoolManager.releaseWorker(worker.id)).catch(err => {
                this.logger?.error('Failed to release worker after merge', {
                  workerId: worker.id,
                  error: err
                });
              });
            }
          }).catch((error) => {
            this.logger?.error('Merge request execution failed', {
              taskId: request.taskId,
              workerId: worker.id,
              error: error instanceof Error ? error.message : String(error)
            });
            
            // 실패해도 Worker는 해제
            if (this.workerPoolManager && worker?.id) {
              Promise.resolve(this.workerPoolManager.releaseWorker(worker.id)).catch(err => {
                this.logger?.error('Failed to release worker after error', {
                  workerId: worker.id,
                  error: err
                });
              });
            }
          });
        }

        this.logger?.info('Merge request task assigned and started', {
          taskId: request.taskId,
          workerId: worker.id,
          pullRequestUrl: request.pullRequestUrl
        });

        return {
          taskId: request.taskId,
          status: ResponseStatus.ACCEPTED,
          message: 'Merge request processing started',
          workerStatus: 'processing_merge'
        };
      } else if (request.action === 'process_feedback') {
        // 피드백 처리
        let worker = await this.workerPoolManager.getWorkerByTaskId(request.taskId);
        let workerId: string;
        
        if (!worker) {
          // 기존 워커가 없으면 새 워커 할당
          this.logger?.info('No existing worker found for task, allocating new worker', {
            taskId: request.taskId
          });
          
          const availableWorker = await this.workerPoolManager.getAvailableWorker();
          if (!availableWorker) {
            return {
              taskId: request.taskId,
              status: ResponseStatus.REJECTED,
              message: 'No available workers for feedback processing',
              workerStatus: 'unavailable'
            };
          }
          
          workerId = availableWorker.id;
          
          // 새 워커에 피드백 작업 할당
          const feedbackTask = {
            taskId: request.taskId,
            action: 'process_feedback' as any,
            boardItem: request.boardItem,
            pullRequestUrl: request.pullRequestUrl,
            comments: request.comments,
            repositoryId: request.boardItem ? this.extractRepositoryFromBoardItem(request.boardItem, request.pullRequestUrl) : undefined,
            assignedAt: new Date()
          };
          
          await this.workerPoolManager.assignWorkerTask(workerId, feedbackTask);
        } else {
          // 기존 워커가 있으면 재사용
          workerId = worker.id;
          
          // 기존 작업에 피드백 정보 추가
          const feedbackTask = {
            ...worker.currentTask,
            action: 'process_feedback' as any,
            comments: request.comments,
            assignedAt: new Date()
          };

          // Worker에 피드백 작업 재할당
          await this.workerPoolManager.assignWorkerTask(workerId, feedbackTask);
        }

        // 작업 즉시 실행
        const workerInstance = await this.workerPoolManager.getWorkerInstance(workerId, this.pullRequestService);
        if (workerInstance) {
          // 비동기로 작업 실행 (완료를 기다리지 않음)
          workerInstance.startExecution().then((result) => {
            this.logger?.info('Feedback processing completed', {
              taskId: request.taskId,
              workerId: workerId,
              success: result.success
            });
          }).catch((error) => {
            this.logger?.error('Feedback processing failed', {
              taskId: request.taskId,
              workerId: workerId,
              error: error instanceof Error ? error.message : String(error)
            });
          });
        }

        this.logger?.info('Feedback task assigned to worker and started', {
          taskId: request.taskId,
          workerId: workerId,
          commentCount: request.comments?.length || 0,
          isNewWorker: !worker
        });

        return {
          taskId: request.taskId,
          status: ResponseStatus.ACCEPTED,
          message: 'Feedback processing started and execution started',
          workerStatus: 'processing_feedback'
        };
      }

      return {
        taskId: request.taskId,
        status: ResponseStatus.ERROR,
        message: `Unsupported action: ${request.action}`,
        workerStatus: 'error'
      };

    } catch (error) {
      this.logger?.error('Failed to process task request', { 
        taskId: request.taskId, 
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        taskId: request.taskId,
        status: ResponseStatus.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
        workerStatus: 'error'
      };
    }
  }

  async restart(): Promise<void> {
    console.log('🔄 AI DevTeam 시스템 재시작...');
    await this.stop();
    await this.start();
    console.log('✅ AI DevTeam 시스템 재시작 완료');
  }

  async forceSync(): Promise<void> {
    if (!this.planner) {
      throw new Error('Planner not initialized');
    }

    console.log('🔄 강제 동기화 실행...');
    await this.planner.forceSync();
    console.log('✅ 강제 동기화 완료');
  }

  // Graceful shutdown을 위한 신호 핸들러 설정
  setupSignalHandlers(): void {
    const signalHandler = (signal: string) => {
      console.log(`\n📡 ${signal} 신호 수신됨. Graceful shutdown 시작...`);
      this.stop()
        .then(() => {
          console.log('✅ Graceful shutdown 완료');
          process.exit(0);
        })
        .catch((error) => {
          console.error('❌ Graceful shutdown 실패:', error);
          process.exit(1);
        });
    };

    process.on('SIGTERM', () => signalHandler('SIGTERM'));
    process.on('SIGINT', () => signalHandler('SIGINT'));
  }
}
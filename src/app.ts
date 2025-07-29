import { AppConfig } from './config/app-config';
import { Planner } from './services/planner';
import { WorkerPoolManager } from './services/manager/worker-pool-manager';
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
  ResponseStatus 
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
  private extractRepositoryFromBoardItem(boardItem: any): string {
    // boardItem에서 repository 정보 추출
    // 실제 구현에서는 GitHub Projects API 응답 구조에 맞게 수정
    if (boardItem?.repository?.id) {
      return boardItem.repository.id;
    }
    if (boardItem?.content?.repository?.nameWithOwner) {
      return boardItem.content.repository.nameWithOwner;
    }
    // 기본값으로 config에서 repository 정보 사용
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

      // 작업이 이미 할당되어 있다면 실행
      const currentTask = workerInstance.getCurrentTask();
      if (currentTask?.taskId === request.taskId) {
        // 이미 실행 중인지 확인
        if (workerInstance.getStatus() === 'working') {
          return { success: false }; // 아직 진행 중
        }
        
        // 작업 실행
        const result = await workerInstance.startExecution();
        
        return {
          success: result.success,
          pullRequestUrl: result.pullRequestUrl
        };
      }

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
      this.logger.info('StateManager initialized');

      // 3. 서비스들 초기화
      // GitHub Projects v2 및 PullRequest 서비스 사용
      const serviceFactory = new ServiceFactory(this.logger);
      const githubV2Config = ServiceFactory.createGitHubV2ConfigFromEnv();
      this.projectBoardService = serviceFactory.createProjectBoardService(githubV2Config);
      this.pullRequestService = serviceFactory.createPullRequestService(githubV2Config);
      this.logger.info('Services initialized', { 
        projectBoardService: 'GitHub Projects v2',
        pullRequestService: 'GitHub',
        config: githubV2Config
      });

      // 4. WorkerPoolManager 초기화
      this.workerPoolManager = new WorkerPoolManager(
        {
          workspaceBasePath: this.config.manager.workspaceRoot,
          minWorkers: this.config.manager.workerPool.minWorkers,
          maxWorkers: this.config.manager.workerPool.maxWorkers,
          workerRecoveryTimeoutMs: this.config.manager.workerPool.workerTimeoutMs,
          gitOperationTimeoutMs: 60000,
          repositoryCacheTimeoutMs: 300000
        },
        { 
          logger: this.logger, 
          stateManager: this.stateManager 
        }
      );
      this.logger.info('WorkerPoolManager initialized');

      // 5. Manager Communicator 구현
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

              this.logger?.info('Task assigned to worker with full info', {
                taskId: request.taskId,
                workerId: availableWorker.id,
                repositoryId: workerTask.repositoryId,
                action: workerTask.action
              });

              return {
                taskId: request.taskId,
                status: ResponseStatus.ACCEPTED,
                message: 'Task assigned to worker with full information',
                workerStatus: 'assigned'
              };

            } else if (request.action === 'check_status') {
              // 작업 상태 확인
              const worker = await this.workerPoolManager.getWorkerByTaskId(request.taskId);
              if (!worker) {
                return {
                  taskId: request.taskId,
                  status: ResponseStatus.ERROR,
                  message: 'Worker not found for task',
                  workerStatus: 'not_found'
                };
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
              const worker = await this.workerPoolManager.getWorkerByTaskId(request.taskId);
              if (!worker) {
                return {
                  taskId: request.taskId,
                  status: ResponseStatus.ERROR,
                  message: 'Worker not found for feedback processing',
                  workerStatus: 'not_found'
                };
              }

              // 기존 작업에 피드백 정보 추가
              const feedbackTask = {
                ...worker.currentTask,
                action: 'process_feedback' as any,
                comments: request.comments,
                assignedAt: new Date()
              };

              // Worker에 피드백 작업 재할당
              await this.workerPoolManager.assignWorkerTask(worker.id, feedbackTask);

              this.logger?.info('Feedback task assigned to worker', {
                taskId: request.taskId,
                workerId: worker.id,
                commentCount: request.comments?.length || 0
              });

              return {
                taskId: request.taskId,
                status: ResponseStatus.ACCEPTED,
                message: 'Feedback processing started with full task information',
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
      };

      // 6. Planner 초기화
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
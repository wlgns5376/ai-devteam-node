import { AppConfig } from './config/app-config';
import { Planner } from './services/planner';
import { WorkerPoolManager } from './services/manager/worker-pool-manager';
import { WorkspaceManager } from './services/manager/workspace-manager';
import { Logger, LogLevel } from './services/logger';
import { StateManager } from './services/state-manager';
import { ServiceFactory } from './services/service-factory';
import { ProjectBoardService, PullRequestService } from './types';
import { DeveloperFactory } from './services/developer/developer-factory';
import { TaskRequestHandler } from './app/TaskRequestHandler';
import { RepositoryInfoExtractor } from './utils/RepositoryInfoExtractor';
import { 
  PlannerDependencies, 
  ManagerCommunicator, 
  TaskRequest, 
  TaskResponse, 
  ResponseStatus,
  DeveloperConfig,
  SystemDeveloperConfig,
  WorkerAction,
  SystemStatus
} from '@/types';

export { SystemStatus } from '@/types';

export class AIDevTeamApp {
  private planner?: Planner;
  private workerPoolManager?: WorkerPoolManager;
  private logger?: Logger;
  private stateManager?: StateManager;
  private projectBoardService?: ProjectBoardService;
  private pullRequestService?: PullRequestService;
  private taskRequestHandler?: TaskRequestHandler;
  
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
    return RepositoryInfoExtractor.extractRepositoryFromBoardItem(
      boardItem, 
      pullRequestUrl, 
      this.config.planner?.repoId
    );
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

      // 6. TaskRequestHandler 초기화
      this.taskRequestHandler = new TaskRequestHandler(
        this.workerPoolManager,
        this.projectBoardService,
        this.pullRequestService,
        this.logger,
        this.extractRepositoryFromBoardItem.bind(this)
      );

      // 7. Manager Communicator 구현
      const managerCommunicator: ManagerCommunicator = {
        sendTaskToManager: async (request: TaskRequest): Promise<TaskResponse> => {
          if (!this.taskRequestHandler) {
            throw new Error('TaskRequestHandler not initialized');
          }
          
          return await this.taskRequestHandler.handleTaskRequest(request);
        }
      };

      // 8. Planner 초기화
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
    if (!this.taskRequestHandler) {
      throw new Error('TaskRequestHandler not initialized');
    }

    return await this.taskRequestHandler.handleTaskRequest(request);
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
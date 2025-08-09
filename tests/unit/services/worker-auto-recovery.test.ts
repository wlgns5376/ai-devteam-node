import { WorkerPoolManager } from '@/services/manager/worker-pool-manager';
import { Logger } from '@/services/logger';
import { DeveloperFactory } from '@/services/developer/developer-factory';
import { WorkspaceSetup } from '@/services/worker/workspace-setup';
import { PromptGenerator } from '@/services/worker/prompt-generator';
import { ResultProcessor } from '@/services/worker/result-processor';
import { 
  WorkerStatus,
  WorkerTask,
  WorkerAction,
  ManagerServiceConfig,
  Worker as WorkerType
} from '@/types';

// Mock all the required classes
jest.mock('@/services/developer/developer-factory');
jest.mock('@/services/worker/workspace-setup');
jest.mock('@/services/worker/prompt-generator');
jest.mock('@/services/worker/result-processor');

const MockedDeveloperFactory = DeveloperFactory as jest.Mocked<typeof DeveloperFactory>;

describe('Worker 자동 복구 시나리오', () => {
  let workerPoolManager: WorkerPoolManager;
  let mockLogger: jest.Mocked<Logger>;
  let config: ManagerServiceConfig;
  let mockStateManager: any;

  // 자동 복구 관련 설정값들
  const WORKER_TIMEOUT_MS = 30 * 60 * 1000; // 30분
  const RECOVERY_TIMEOUT_MS = 5 * 60 * 1000; // 5분

  beforeEach(() => {
    // Logger Mock
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      setLevel: jest.fn(),
      getLevel: jest.fn().mockReturnValue('info')
    } as any;
    
    // Mock 설정
    const mockDeveloper = {
      initialize: jest.fn().mockResolvedValue(undefined),
      executePrompt: jest.fn().mockResolvedValue({ rawOutput: 'mock output' }),
      cleanup: jest.fn().mockResolvedValue(undefined),
      getStatus: jest.fn().mockReturnValue('ready'),
      isInitialized: jest.fn().mockReturnValue(true)
    };
    
    MockedDeveloperFactory.create.mockReturnValue(mockDeveloper as any);
    
    config = {
      workspaceBasePath: '/tmp/workspace',
      minWorkers: 2,
      maxWorkers: 5,
      workerRecoveryTimeoutMs: RECOVERY_TIMEOUT_MS,
      gitOperationTimeoutMs: 30 * 1000,
      repositoryCacheTimeoutMs: 5 * 60 * 1000,
      workerLifecycle: {
        idleTimeoutMinutes: 30,
        cleanupIntervalMinutes: 60,
        minPersistentWorkers: 1
      }
    };

    mockStateManager = {
      saveWorker: jest.fn().mockResolvedValue(undefined),
      updateWorkerStatus: jest.fn().mockResolvedValue(undefined),
      removeWorker: jest.fn().mockResolvedValue(undefined),
      getWorker: jest.fn().mockResolvedValue(null),
      getAllWorkers: jest.fn().mockResolvedValue([]),
      getActiveWorkers: jest.fn().mockResolvedValue([]),
      cleanupIdleWorkers: jest.fn().mockResolvedValue([])
    };

    const mockWorkspaceManager = {
      createWorkspace: jest.fn().mockResolvedValue({}),
      setupWorktree: jest.fn().mockResolvedValue(undefined),
      setupClaudeLocal: jest.fn().mockResolvedValue(undefined),
      cleanupWorkspace: jest.fn().mockResolvedValue(undefined),
      getWorkspaceInfo: jest.fn().mockResolvedValue(null)
    };

    // WorkerPoolManager 설정
    workerPoolManager = new WorkerPoolManager(config, {
      logger: mockLogger,
      workspaceManager: mockWorkspaceManager,
      stateManager: mockStateManager,
      developerConfig: {
        claude: { 
          enabled: true,
          command: 'claude',
          args: [],
          workingDir: '/tmp'
        },
        gemini: { 
          enabled: true,
          command: 'gemini',
          args: [],
          workingDir: '/tmp'
        }
      } as any
    });
  });

  afterEach(async () => {
    if (workerPoolManager) {
      await workerPoolManager.shutdown();
    }
  });

  describe('Worker Pool 초기화', () => {
    it('최소 Worker 수가 생성되어야 한다', async () => {
      // When: Pool을 초기화하면
      await workerPoolManager.initializePool();
      const poolStatus = workerPoolManager.getPoolStatus();
      
      // Then: 최소 Worker 수가 유지되어야 함
      expect(poolStatus.totalWorkers).toBeGreaterThanOrEqual(config.minWorkers);
      expect(poolStatus.totalWorkers).toBeLessThanOrEqual(config.maxWorkers);
    });
  });

  describe('Worker 상태 관리', () => {
    it('Worker 상태를 업데이트할 수 있어야 한다', async () => {
      // Given: Pool 초기화
      await workerPoolManager.initializePool();
      const poolStatus = workerPoolManager.getPoolStatus();
      expect(poolStatus.workers.length).toBeGreaterThan(0);
      
      const workerId = poolStatus.workers[0]!.id;

      // When: Worker 상태를 업데이트하면
      await workerPoolManager.updateWorkerStatus(workerId, WorkerStatus.STOPPED);

      // Then: 상태가 업데이트되어야 함
      const updatedPoolStatus = workerPoolManager.getPoolStatus();
      const updatedWorker = updatedPoolStatus.workers.find(w => w.id === workerId);
      expect(updatedWorker?.status).toBe(WorkerStatus.STOPPED);
    });
  });

  describe('자동 복구 메커니즘', () => {
    it('복구 타임아웃이 지난 중지된 Worker를 복구해야 한다', async () => {
      // Given: Pool 초기화
      await workerPoolManager.initializePool();
      const poolStatus = workerPoolManager.getPoolStatus();
      const workers = poolStatus.workers;
      expect(workers.length).toBeGreaterThan(0);
      
      const workerId = workers[0]!.id;
      
      // Worker를 중지 상태로 변경
      await workerPoolManager.updateWorkerStatus(workerId, WorkerStatus.STOPPED);
      
      // 복구 타임아웃 시간이 지난 것으로 시뮬레이션
      const workerMap = (workerPoolManager as any).workers;
      const worker = workerMap.get(workerId);
      if (worker) {
        const stoppedWorker = {
          ...worker,
          status: WorkerStatus.STOPPED,
          lastActiveAt: new Date(Date.now() - RECOVERY_TIMEOUT_MS - 1000) // 복구 타임아웃 + 1초
        };
        workerMap.set(workerId, stoppedWorker);
      }

      const initialPoolStatus = workerPoolManager.getPoolStatus();
      expect(initialPoolStatus.stoppedWorkers).toBe(1);

      // When: 자동 복구를 실행
      await workerPoolManager.recoverStoppedWorkers();

      // Then: 중지된 Worker가 복구되어야 함
      const recoveredPoolStatus = workerPoolManager.getPoolStatus();
      
      // 복구된 Worker는 WAITING 상태가 됨
      expect(recoveredPoolStatus.stoppedWorkers).toBe(0);
      
      const recoveredWorker = recoveredPoolStatus.workers.find(w => w.id === workerId);
      expect(recoveredWorker?.status).toBe(WorkerStatus.WAITING);
    });

    it('복구 타임아웃 이전의 중지된 Worker는 복구하지 않아야 한다', async () => {
      // Given: Pool 초기화
      await workerPoolManager.initializePool();
      const poolStatus = workerPoolManager.getPoolStatus();
      const workers = poolStatus.workers;
      expect(workers.length).toBeGreaterThan(0);
      
      const workerId = workers[0]!.id;
      
      // Worker를 중지 상태로 변경 (최근에 중지됨)
      await workerPoolManager.updateWorkerStatus(workerId, WorkerStatus.STOPPED);

      const initialPoolStatus = workerPoolManager.getPoolStatus();
      expect(initialPoolStatus.stoppedWorkers).toBe(1);

      // When: 자동 복구를 실행 (복구 타임아웃 이전)
      await workerPoolManager.recoverStoppedWorkers();

      // Then: 중지된 Worker는 복구되지 않아야 함
      const poolStatusAfterRecovery = workerPoolManager.getPoolStatus();
      expect(poolStatusAfterRecovery.stoppedWorkers).toBe(1);
      
      const stoppedWorker = poolStatusAfterRecovery.workers.find(w => w.id === workerId);
      expect(stoppedWorker?.status).toBe(WorkerStatus.STOPPED);
    });
  });

  describe('Worker 작업 할당', () => {
    it('복구된 Worker에게 작업을 할당할 수 있어야 한다', async () => {
      // Given: Pool 초기화 및 Worker 복구
      await workerPoolManager.initializePool();
      
      // When: 사용 가능한 Worker를 조회하면
      const availableWorker = await workerPoolManager.getAvailableWorker();
      
      // Then: Worker를 얻을 수 있어야 함
      expect(availableWorker).toBeDefined();

      // 작업 할당이 가능해야 함
      if (availableWorker) {
        const task: WorkerTask = {
          taskId: 'test-task',
          action: WorkerAction.START_NEW_TASK,
          repositoryId: 'owner/repo',
          assignedAt: new Date()
        };

        await expect(workerPoolManager.assignWorkerTask(availableWorker.id, task))
          .resolves.not.toThrow();
      }
    });
  });

  describe('로깅', () => {
    it('Pool 초기화 과정을 로깅해야 한다', async () => {
      // When: Pool을 초기화하면
      await workerPoolManager.initializePool();

      // Then: 초기화 관련 로그가 기록되어야 함
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initializing worker pool',
        expect.objectContaining({
          minWorkers: config.minWorkers,
          maxWorkers: config.maxWorkers
        })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Worker pool initialized',
        expect.objectContaining({
          minWorkers: config.minWorkers,
          maxWorkers: config.maxWorkers
        })
      );
    });

    it('Worker 상태 업데이트를 로깅해야 한다', async () => {
      // Given: Pool 초기화
      await workerPoolManager.initializePool();
      const poolStatus = workerPoolManager.getPoolStatus();
      const workers = poolStatus.workers;
      expect(workers.length).toBeGreaterThan(0);
      
      const workerId = workers[0]!.id;

      // When: Worker 상태를 업데이트하면
      await workerPoolManager.updateWorkerStatus(workerId, WorkerStatus.STOPPED);

      // Then: 상태 업데이트 로그가 기록되어야 함
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Worker status updated',
        {
          workerId,
          status: WorkerStatus.STOPPED
        }
      );
    });

    it('Worker 복구 과정을 로깅해야 한다', async () => {
      // Given: Pool 초기화 및 Worker 중지
      await workerPoolManager.initializePool();
      const poolStatus = workerPoolManager.getPoolStatus();
      const workers = poolStatus.workers;
      expect(workers.length).toBeGreaterThan(0);
      
      const workerId = workers[0]!.id;
      
      // Worker를 중지 상태로 변경
      await workerPoolManager.updateWorkerStatus(workerId, WorkerStatus.STOPPED);
      
      // 복구 타임아웃 시간이 지난 것으로 시뮬레이션
      const workerMap = (workerPoolManager as any).workers;
      const worker = workerMap.get(workerId);
      if (worker) {
        const stoppedWorker = {
          ...worker,
          status: WorkerStatus.STOPPED,
          lastActiveAt: new Date(Date.now() - RECOVERY_TIMEOUT_MS - 1000)
        };
        workerMap.set(workerId, stoppedWorker);
      }

      // When: 복구 프로세스를 실행하면
      await workerPoolManager.recoverStoppedWorkers();

      // Then: 복구 관련 로그가 기록되어야 함
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Worker recovered from stopped state',
        { workerId }
      );
    });
  });
});
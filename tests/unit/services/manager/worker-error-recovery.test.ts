import { WorkerPoolManager } from '@/services/manager/worker-pool-manager';
import { WorkerStatus, WorkerAction } from '@/types';
import { Logger } from '@/services/logger';

describe('WorkerPoolManager Error Recovery', () => {
  let workerPoolManager: WorkerPoolManager;
  let mockDependencies: any;
  let mockConfig: any;

  beforeEach(() => {
    // Mock dependencies 설정
    mockDependencies = {
      logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
      } as unknown as Logger,
      stateManager: {
        saveWorker: jest.fn(),
        getAllWorkers: jest.fn().mockResolvedValue([]),
        cleanupIdleWorkers: jest.fn().mockResolvedValue([])
      },
      repositoryService: {
        getRepositoryInfo: jest.fn()
      },
      gitService: {
        isValidRepository: jest.fn()
      }
    };

    // Mock config 설정
    mockConfig = {
      workspaceBasePath: '/workspace',
      minWorkers: 1,
      maxWorkers: 5,
      workerRecoveryTimeoutMs: 60000, // 1분
      gitOperationTimeoutMs: 30000,
      repositoryCacheTimeoutMs: 300000,
      workerLifecycle: {
        idleTimeoutMinutes: 30,
        cleanupIntervalMinutes: 5,
        minPersistentWorkers: 1
      },
      developer: {
        timeoutMs: 30000,
        maxRetries: 3,
        retryDelayMs: 1000,
        mock: {
          responseDelay: 100
        }
      }
    };

    workerPoolManager = new WorkerPoolManager(mockConfig, mockDependencies);
  });

  describe('ERROR 상태 Worker 복구', () => {
    it('ERROR 상태의 Worker를 시간 경과 후 WAITING 상태로 복구해야 함', async () => {
      // Given: WorkerPoolManager 초기화 (실제 Worker 생성 없이)
      // await workerPoolManager.initializePool();

      // ERROR 상태의 Worker 생성 (직접 Map에 추가)
      const errorWorker = {
        id: 'worker-error-1',
        status: WorkerStatus.ERROR,
        currentTask: {
          taskId: 'task-1',
          action: WorkerAction.PROCESS_FEEDBACK,
          repositoryId: 'test/repo',
          assignedAt: new Date()
        },
        workspaceDir: '/workspace/worker-error-1',
        developerType: 'claude' as const,
        createdAt: new Date(),
        lastActiveAt: new Date(Date.now() - 40000) // 40초 전 (복구 시간의 절반인 30초 이상)
      };

      // Map에 직접 추가 (private 필드 접근을 위한 우회)
      (workerPoolManager as any).workers.set(errorWorker.id, errorWorker);

      // Mock Worker 인스턴스 추가
      const mockWorkerInstance = {
        resumeExecution: jest.fn().mockResolvedValue(undefined)
      };
      (workerPoolManager as any).workerInstances.set(errorWorker.id, mockWorkerInstance);

      // When: ERROR Worker 복구 실행
      await workerPoolManager.recoverErrorWorkers();

      // Then: Worker가 WAITING 상태로 복구되어야 함
      expect(mockDependencies.stateManager.saveWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'worker-error-1',
          status: WorkerStatus.WAITING,
          currentTask: errorWorker.currentTask
        })
      );

      // Worker 인스턴스의 resumeExecution이 호출되어야 함
      expect(mockWorkerInstance.resumeExecution).toHaveBeenCalled();

      // 복구 로그가 출력되어야 함
      expect(mockDependencies.logger.info).toHaveBeenCalledWith(
        'Worker recovered from error state',
        expect.objectContaining({
          workerId: 'worker-error-1',
          taskId: 'task-1',
          recoveryTimeout: 30000 // 기본값의 절반
        })
      );
    });

    it('복구 시간이 지나지 않은 ERROR Worker는 복구하지 않아야 함', async () => {
      // Given: 최근에 ERROR 상태가 된 Worker
      // await workerPoolManager.initializePool();

      const recentErrorWorker = {
        id: 'worker-error-2',
        status: WorkerStatus.ERROR,
        currentTask: {
          taskId: 'task-2',
          action: WorkerAction.PROCESS_FEEDBACK,
          repositoryId: 'test/repo',
          assignedAt: new Date()
        },
        workspaceDir: '/workspace/worker-error-2',
        developerType: 'claude' as const,
        createdAt: new Date(),
        lastActiveAt: new Date(Date.now() - 10000) // 10초 전 (복구 시간 미달)
      };

      (workerPoolManager as any).workers.set(recentErrorWorker.id, recentErrorWorker);

      // When: ERROR Worker 복구 실행
      await workerPoolManager.recoverErrorWorkers();

      // Then: Worker가 복구되지 않아야 함
      expect(mockDependencies.stateManager.saveWorker).not.toHaveBeenCalled();
      expect(mockDependencies.logger.info).not.toHaveBeenCalledWith(
        'Worker recovered from error state',
        expect.any(Object)
      );
    });

    it('여러 ERROR Worker를 동시에 복구할 수 있어야 함', async () => {
      // Given: 여러 ERROR 상태의 Worker
      // await workerPoolManager.initializePool();

      const errorWorkers = [
        {
          id: 'worker-error-3',
          status: WorkerStatus.ERROR,
          currentTask: { taskId: 'task-3', action: WorkerAction.PROCESS_FEEDBACK, repositoryId: 'test/repo', assignedAt: new Date() },
          workspaceDir: '/workspace/worker-error-3',
          developerType: 'claude' as const,
          createdAt: new Date(),
          lastActiveAt: new Date(Date.now() - 40000)
        },
        {
          id: 'worker-error-4',
          status: WorkerStatus.ERROR,
          currentTask: { taskId: 'task-4', action: WorkerAction.PROCESS_FEEDBACK, repositoryId: 'test/repo', assignedAt: new Date() },
          workspaceDir: '/workspace/worker-error-4',
          developerType: 'gemini' as const,
          createdAt: new Date(),
          lastActiveAt: new Date(Date.now() - 50000)
        }
      ];

      errorWorkers.forEach(worker => {
        (workerPoolManager as any).workers.set(worker.id, worker);
        (workerPoolManager as any).workerInstances.set(worker.id, {
          resumeExecution: jest.fn().mockResolvedValue(undefined)
        });
      });

      // When: ERROR Worker 복구 실행
      await workerPoolManager.recoverErrorWorkers();

      // Then: 모든 Worker가 복구되어야 함
      expect(mockDependencies.stateManager.saveWorker).toHaveBeenCalledTimes(2);
      
      expect(mockDependencies.logger.info).toHaveBeenCalledWith(
        'Error worker recovery completed',
        expect.objectContaining({
          recoveredCount: 2,
          recoveredWorkers: ['worker-error-3', 'worker-error-4']
        })
      );
    });
  });

  describe('Pool 상태 집계', () => {
    it('ERROR 상태의 Worker 수를 정확히 집계해야 함', async () => {
      // Given: 다양한 상태의 Worker들
      // await workerPoolManager.initializePool();

      const workers = [
        { id: 'w1', status: WorkerStatus.IDLE, workspaceDir: '/w1', developerType: 'claude' as const, createdAt: new Date(), lastActiveAt: new Date() },
        { id: 'w2', status: WorkerStatus.WORKING, workspaceDir: '/w2', developerType: 'claude' as const, createdAt: new Date(), lastActiveAt: new Date() },
        { id: 'w3', status: WorkerStatus.ERROR, workspaceDir: '/w3', developerType: 'claude' as const, createdAt: new Date(), lastActiveAt: new Date() },
        { id: 'w4', status: WorkerStatus.ERROR, workspaceDir: '/w4', developerType: 'gemini' as const, createdAt: new Date(), lastActiveAt: new Date() },
        { id: 'w5', status: WorkerStatus.STOPPED, workspaceDir: '/w5', developerType: 'claude' as const, createdAt: new Date(), lastActiveAt: new Date() }
      ];

      workers.forEach(worker => {
        (workerPoolManager as any).workers.set(worker.id, worker);
      });

      // When: Pool 상태 조회
      const poolStatus = workerPoolManager.getPoolStatus();

      // Then: 각 상태별 Worker 수가 정확해야 함
      expect(poolStatus.totalWorkers).toBe(5);
      expect(poolStatus.idleWorkers).toBe(1);
      expect(poolStatus.activeWorkers).toBe(1);
      expect(poolStatus.errorWorkers).toBe(2);
      expect(poolStatus.stoppedWorkers).toBe(1);
    });
  });
});
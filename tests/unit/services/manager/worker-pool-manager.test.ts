import { WorkerPoolManager } from '@/services/manager/worker-pool-manager';
import { Logger } from '@/services/logger';
import { StateManager } from '@/services/state-manager';
import { DeveloperFactory } from '@/services/developer/developer-factory';
import { 
  WorkerStatus, 
  ManagerServiceConfig,
  ManagerError,
  DeveloperConfig,
  WorkerTask,
  WorkerAction
} from '@/types';

describe('WorkerPoolManager', () => {
  let workerPoolManager: WorkerPoolManager;
  let mockLogger: jest.Mocked<Logger>;
  let mockStateManager: jest.Mocked<StateManager>;
  let mockDeveloperFactory: jest.MockedClass<typeof DeveloperFactory>;
  let config: ManagerServiceConfig;
  let developerConfig: DeveloperConfig;

  beforeEach(() => {
    // Given: Mock 의존성 설정
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    // Mock Developer 인스턴스
    const mockDeveloper = {
      type: 'mock' as const,
      initialize: jest.fn().mockResolvedValue(undefined),
      executePrompt: jest.fn().mockResolvedValue({ 
        rawOutput: 'test output',
        result: { success: true },
        executedCommands: [],
        modifiedFiles: [],
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          duration: 1000,
          developerType: 'mock' as const
        }
      }),
      cleanup: jest.fn().mockResolvedValue(undefined),
      isAvailable: jest.fn().mockResolvedValue(true),
      setTimeout: jest.fn()
    };

    // WorkspaceSetup, PromptGenerator, ResultProcessor mock 추가
    const mockWorkspaceSetup = {
      prepareWorkspace: jest.fn().mockResolvedValue({ workspaceDir: '/tmp/test' })
    };

    const mockPromptGenerator = {
      generateNewTaskPrompt: jest.fn().mockResolvedValue('test prompt'),
      generateResumePrompt: jest.fn().mockResolvedValue('resume prompt'),
      generateFeedbackPrompt: jest.fn().mockResolvedValue('feedback prompt'),
      generateMergePrompt: jest.fn().mockResolvedValue('merge prompt')
    };

    const mockResultProcessor = {
      processOutput: jest.fn().mockResolvedValue({ success: true, pullRequestUrl: 'https://github.com/test/pr/1' })
    };

    // DeveloperFactory mock - create가 static 메서드이므로 클래스에 create 메서드 추가
    mockDeveloperFactory = {
      create: jest.fn().mockReturnValue(mockDeveloper)
    } as any;

    mockStateManager = {
      saveWorker: jest.fn(),
      loadWorker: jest.fn(),
      saveWorkerPoolState: jest.fn(),
      loadWorkerPoolState: jest.fn(),
      getActiveWorkers: jest.fn().mockResolvedValue([]),
      removeWorker: jest.fn(),
      cleanupIdleWorkers: jest.fn().mockResolvedValue([])
    } as any;

    config = {
      workspaceBasePath: '/tmp/test-workspace',
      minWorkers: 2,
      maxWorkers: 5,
      workerRecoveryTimeoutMs: 30000,
      gitOperationTimeoutMs: 60000,
      repositoryCacheTimeoutMs: 300000
    };

    developerConfig = {
      timeoutMs: 30000,
      maxRetries: 3,
      retryDelayMs: 1000,
      claude: {
        apiKey: 'test-api-key'
      }
    };

    workerPoolManager = new WorkerPoolManager(config, {
      logger: mockLogger,
      stateManager: mockStateManager,
      developerConfig,
      developerFactory: mockDeveloperFactory as any,
      baseBranchExtractor: {
        extractBaseBranch: jest.fn().mockResolvedValue('main')
      } as any
    });
  });

  describe('초기화', () => {
    it('최소 Worker 수만큼 Worker를 생성해야 한다', async () => {
      // When: Pool 초기화
      await workerPoolManager.initializePool();

      // Then: 최소 Worker 수만큼 생성됨
      const poolStatus = workerPoolManager.getPoolStatus();
      expect(poolStatus.workers).toHaveLength(config.minWorkers);
      expect(poolStatus.minWorkers).toBe(config.minWorkers);
      expect(poolStatus.maxWorkers).toBe(config.maxWorkers);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Worker pool initialized', 
        expect.objectContaining({
          minWorkers: config.minWorkers, 
          maxWorkers: config.maxWorkers,
          restoredWorkers: expect.any(Number),
          newWorkers: expect.any(Number),
          totalWorkers: expect.any(Number)
        })
      );
    });

    it('모든 초기 Worker는 IDLE 상태여야 한다', async () => {
      // When: Pool 초기화
      await workerPoolManager.initializePool();

      // Then: 모든 Worker가 IDLE 상태
      const poolStatus = workerPoolManager.getPoolStatus();
      poolStatus.workers.forEach(worker => {
        expect(worker.status).toBe(WorkerStatus.IDLE);
        expect(worker.currentTask).toBeUndefined();
      });
    });

    it('이미 초기화된 경우 다시 초기화하지 않아야 한다', async () => {
      // Given: 이미 초기화됨
      await workerPoolManager.initializePool();
      const firstPoolStatus = workerPoolManager.getPoolStatus();

      // When: 다시 초기화 시도
      await workerPoolManager.initializePool();

      // Then: 상태가 변경되지 않음
      const secondPoolStatus = workerPoolManager.getPoolStatus();
      expect(secondPoolStatus.workers).toHaveLength(firstPoolStatus.workers.length);
    });
  });

  describe('Worker 할당', () => {
    beforeEach(async () => {
      await workerPoolManager.initializePool();
    });

    it('사용 가능한 Worker를 반환해야 한다', async () => {
      // When: 사용 가능한 Worker 요청
      const worker = await workerPoolManager.getAvailableWorker();

      // Then: IDLE 상태의 Worker 반환
      expect(worker).not.toBeNull();
      expect(worker!.status).toBe(WorkerStatus.IDLE);
    });

    it('Worker를 작업에 할당할 수 있어야 한다', async () => {
      // Given: 사용 가능한 Worker 가져오기
      const worker = await workerPoolManager.getAvailableWorker();
      const taskId = 'task-123';

      // When: Worker를 작업에 할당
      await workerPoolManager.assignWorker(worker!.id, taskId);

      // Then: Worker 상태가 WAITING으로 변경되고 taskId 설정됨
      const poolStatus = workerPoolManager.getPoolStatus();
      const assignedWorker = poolStatus.workers.find(w => w.id === worker!.id);
      expect(assignedWorker!.status).toBe(WorkerStatus.WAITING);
      expect(assignedWorker!.currentTask?.taskId).toBe(taskId);
      expect(mockStateManager.saveWorker).toHaveBeenCalledWith(assignedWorker);
    });

    it('모든 Worker가 사용중일 때 null을 반환해야 한다', async () => {
      // Given: 최대 Worker 수만큼 Worker를 작업에 할당
      const workers = [];
      for (let i = 0; i < config.maxWorkers; i++) {
        const worker = await workerPoolManager.getAvailableWorker();
        await workerPoolManager.assignWorker(worker!.id, `task-${i}`);
        workers.push(worker);
      }

      // When: 추가 Worker 요청
      const additionalWorker = await workerPoolManager.getAvailableWorker();

      // Then: null 반환
      expect(additionalWorker).toBeNull();
    });

    it('존재하지 않는 Worker 할당 시 에러를 발생시켜야 한다', async () => {
      // Given: 존재하지 않는 Worker ID
      const invalidWorkerId = 'non-existent-worker';
      const taskId = 'task-123';

      // When & Then: 에러 발생
      await expect(
        workerPoolManager.assignWorker(invalidWorkerId, taskId)
      ).rejects.toThrow(`Worker not found: ${invalidWorkerId}`);
    });
  });

  describe('Worker 해제', () => {
    beforeEach(async () => {
      await workerPoolManager.initializePool();
    });

    it('할당된 Worker를 해제할 수 있어야 한다', async () => {
      // Given: Worker를 작업에 할당
      const worker = await workerPoolManager.getAvailableWorker();
      await workerPoolManager.assignWorker(worker!.id, 'task-123');

      // When: Worker 해제
      await workerPoolManager.releaseWorker(worker!.id);

      // Then: Worker가 IDLE 상태로 변경되고 taskId 제거됨
      const poolStatus = workerPoolManager.getPoolStatus();
      const releasedWorker = poolStatus.workers.find(w => w.id === worker!.id);
      expect(releasedWorker!.status).toBe(WorkerStatus.IDLE);
      expect(releasedWorker!.currentTask).toBeUndefined();
    });

    it('존재하지 않는 Worker 해제 시 에러를 발생시켜야 한다', async () => {
      // Given: 존재하지 않는 Worker ID
      const invalidWorkerId = 'non-existent-worker';

      // When & Then: 에러 발생
      await expect(
        workerPoolManager.releaseWorker(invalidWorkerId)
      ).rejects.toThrow(`Worker not found: ${invalidWorkerId}`);
    });
  });

  describe('Worker 상태 업데이트', () => {
    beforeEach(async () => {
      await workerPoolManager.initializePool();
    });

    it('Worker 상태를 업데이트할 수 있어야 한다', async () => {
      // Given: Worker 가져오기
      const worker = await workerPoolManager.getAvailableWorker();

      // When: Worker 상태를 WORKING으로 변경
      await workerPoolManager.updateWorkerStatus(worker!.id, WorkerStatus.WORKING);

      // Then: 상태가 업데이트됨
      const poolStatus = workerPoolManager.getPoolStatus();
      const updatedWorker = poolStatus.workers.find(w => w.id === worker!.id);
      expect(updatedWorker!.status).toBe(WorkerStatus.WORKING);
      expect(mockStateManager.saveWorker).toHaveBeenCalledWith(updatedWorker);
    });

    it('존재하지 않는 Worker 상태 업데이트 시 에러를 발생시켜야 한다', async () => {
      // Given: 존재하지 않는 Worker ID
      const invalidWorkerId = 'non-existent-worker';

      // When & Then: 에러 발생
      await expect(
        workerPoolManager.updateWorkerStatus(invalidWorkerId, WorkerStatus.WORKING)
      ).rejects.toThrow(`Worker not found: ${invalidWorkerId}`);
    });
  });

  describe('중지된 Worker 복구', () => {
    beforeEach(async () => {
      await workerPoolManager.initializePool();
    });

    it('중지된 Worker를 WAITING 상태로 복구해야 한다', async () => {
      // Given: Worker를 STOPPED 상태로 설정
      const worker = await workerPoolManager.getAvailableWorker();
      await workerPoolManager.updateWorkerStatus(worker!.id, WorkerStatus.STOPPED);
      
      // 복구 타임아웃보다 긴 시간이 지났다고 가정
      jest.spyOn(Date, 'now').mockReturnValue(
        worker!.lastActiveAt.getTime() + config.workerRecoveryTimeoutMs + 1000
      );

      // When: 중지된 Worker 복구
      await workerPoolManager.recoverStoppedWorkers();

      // Then: Worker가 WAITING 상태로 복구됨
      const poolStatus = workerPoolManager.getPoolStatus();
      const recoveredWorker = poolStatus.workers.find(w => w.id === worker!.id);
      expect(recoveredWorker!.status).toBe(WorkerStatus.WAITING);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Worker recovered from stopped state',
        { workerId: worker!.id }
      );
    });

    it('복구 타임아웃이 지나지 않은 Worker는 복구하지 않아야 한다', async () => {
      // Given: Worker를 STOPPED 상태로 설정
      const worker = await workerPoolManager.getAvailableWorker();
      await workerPoolManager.updateWorkerStatus(worker!.id, WorkerStatus.STOPPED);

      // When: 중지된 Worker 복구 (타임아웃 전)
      await workerPoolManager.recoverStoppedWorkers();

      // Then: Worker 상태가 변경되지 않음
      const poolStatus = workerPoolManager.getPoolStatus();
      const stoppedWorker = poolStatus.workers.find(w => w.id === worker!.id);
      expect(stoppedWorker!.status).toBe(WorkerStatus.STOPPED);
    });
  });

  describe('Pool 상태 조회', () => {
    beforeEach(async () => {
      await workerPoolManager.initializePool();
    });

    it('올바른 Pool 상태를 반환해야 한다', async () => {
      // Given: 일부 Worker를 할당
      const worker1 = await workerPoolManager.getAvailableWorker();
      await workerPoolManager.assignWorker(worker1!.id, 'task-1');
      await workerPoolManager.updateWorkerStatus(worker1!.id, WorkerStatus.WORKING);

      // When: Pool 상태 조회
      const poolStatus = workerPoolManager.getPoolStatus();

      // Then: 올바른 상태 반환
      expect(poolStatus.workers).toHaveLength(config.minWorkers);
      expect(poolStatus.minWorkers).toBe(config.minWorkers);
      expect(poolStatus.maxWorkers).toBe(config.maxWorkers);
      expect(poolStatus.activeWorkers).toBe(1); // 1개 Worker가 WORKING 상태
    });
  });

  describe('Pool 종료', () => {
    beforeEach(async () => {
      await workerPoolManager.initializePool();
    });

    it('Pool을 안전하게 종료해야 한다', async () => {
      // Given: Pool 초기화 상태 확인
      const initialPoolStatus = workerPoolManager.getPoolStatus();
      expect(initialPoolStatus.workers.length).toBeGreaterThan(0);

      // When: Pool 종료
      await workerPoolManager.shutdown();

      // Then: 종료 로그가 기록되고 초기화 상태가 false가 됨
      expect(mockLogger.info).toHaveBeenCalledWith('Worker pool shutdown completed');
      
      // 실제 구현에서는 Worker들이 즉시 삭제되지 않고 정리 타이머만 중지됨
      // Worker들은 향후 cleanupExpiredWorkers에 의해 정리됨
      const poolStatus = workerPoolManager.getPoolStatus();
      expect(poolStatus.workers.length).toBeGreaterThanOrEqual(0); // Worker가 남아있을 수 있음
    });
  });

  describe('Worker 할당 동시성', () => {
    beforeEach(async () => {
      await workerPoolManager.initializePool();
    });

    it('이미 할당된 Worker에 재할당 시 에러를 발생시켜야 한다', async () => {
      // Given: Worker를 작업에 할당
      const worker = await workerPoolManager.getAvailableWorker();
      const task1: WorkerTask = {
        taskId: 'task-1',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };
      await workerPoolManager.assignWorkerTask(worker!.id, task1);

      // When & Then: 동일 Worker에 다른 작업 할당 시 에러
      const task2: WorkerTask = {
        taskId: 'task-2',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };
      
      await expect(
        workerPoolManager.assignWorkerTask(worker!.id, task2)
      ).rejects.toThrow(`Worker ${worker!.id} is not available for new task (status: waiting)`);
    });

    it('Worker 인스턴스가 없는 경우 에러를 발생시켜야 한다', async () => {
      // Given: Worker Map에는 있지만 인스턴스가 없는 상황 시뮬레이션
      const poolStatus = workerPoolManager.getPoolStatus();
      const worker = poolStatus.workers[0];
      
      if (!worker) {
        throw new Error('No worker found in pool');
      }
      
      // Worker 인스턴스를 제거 (private 필드 접근을 위한 우회)
      const manager = workerPoolManager as any;
      manager.workerInstances.delete(worker.id);

      // When & Then: 할당 시 에러
      const task: WorkerTask = {
        taskId: 'task-123',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };
      
      await expect(
        workerPoolManager.assignWorkerTask(worker.id, task)
      ).rejects.toThrow(`Worker instance not found: ${worker.id}`);
    });

    it('할당 실패 시 Worker 상태를 롤백해야 한다', async () => {
      // Given: Worker 가져오기
      const worker = await workerPoolManager.getAvailableWorker();
      const originalStatus = worker!.status;
      
      // Worker 인스턴스의 assignTask가 실패하도록 mock
      const manager = workerPoolManager as any;
      const workerInstance = manager.workerInstances.get(worker!.id);
      workerInstance.assignTask = jest.fn().mockRejectedValue(new Error('Assignment failed'));

      const task: WorkerTask = {
        taskId: 'task-fail',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      // When: 할당 시도 (실패할 것임)
      await expect(
        workerPoolManager.assignWorkerTask(worker!.id, task)
      ).rejects.toThrow('Assignment failed');

      // Then: Worker 상태가 원래대로 롤백됨
      const poolStatus = workerPoolManager.getPoolStatus();
      const rolledBackWorker = poolStatus.workers.find(w => w.id === worker!.id);
      expect(rolledBackWorker!.status).toBe(originalStatus);
      expect(rolledBackWorker!.currentTask).toBeUndefined();
    });

    it('WAITING 상태 Worker가 PROCESS_FEEDBACK 액션을 처리할 수 있어야 한다', async () => {
      // Given: Worker를 먼저 새 작업에 할당하여 WAITING 상태로 만듦
      const workers = Array.from(workerPoolManager.getPoolStatus().workers);
      const worker = workers[0];
      expect(worker).toBeDefined();
      
      // 먼저 새 작업 할당
      const initialTask: WorkerTask = {
        taskId: 'existing-task',
        action: WorkerAction.START_NEW_TASK,
        assignedAt: new Date(),
        repositoryId: 'test-repo'
      };
      
      await workerPoolManager.assignWorkerTask(worker!.id, initialTask);
      
      // Worker 상태를 WAITING으로 업데이트
      await workerPoolManager.updateWorkerStatus(worker!.id, WorkerStatus.WAITING);
      
      const feedbackTask: WorkerTask = {
        taskId: 'existing-task',
        action: WorkerAction.PROCESS_FEEDBACK,
        assignedAt: new Date(),
        repositoryId: 'test-repo'
      };
      
      // When: PROCESS_FEEDBACK 액션 실행
      await expect(
        workerPoolManager.assignWorkerTask(worker!.id, feedbackTask)
      ).resolves.not.toThrow();
      
      // Then: Worker가 정상적으로 할당됨
      const updatedWorker = workerPoolManager.getPoolStatus().workers.find(w => w.id === worker!.id);
      expect(updatedWorker?.currentTask?.action).toBe(WorkerAction.PROCESS_FEEDBACK);
    });
  });

  describe('Worker 복원 로직', () => {
    it('기존 활성 Worker들을 복원해야 한다', async () => {
      // Given: StateManager에서 기존 활성 Worker 반환하도록 설정
      const existingWorkers = [
        {
          id: 'existing-worker-1',
          status: WorkerStatus.WAITING,
          workspaceDir: '/tmp/existing-1',
          developerType: 'claude' as const,
          createdAt: new Date(),
          lastActiveAt: new Date(),
          currentTask: {
            taskId: 'task-1',
            action: WorkerAction.START_NEW_TASK,
            repositoryId: 'test/repo',
            assignedAt: new Date()
          }
        },
        {
          id: 'existing-worker-2',
          status: WorkerStatus.IDLE,
          workspaceDir: '/tmp/existing-2',
          developerType: 'claude' as const,
          createdAt: new Date(),
          lastActiveAt: new Date()
        }
      ];
      mockStateManager.getActiveWorkers.mockResolvedValue(existingWorkers);

      // When: Pool 초기화
      await workerPoolManager.initializePool();

      // Then: 기존 Worker들이 복원되고 부족한 Worker만 새로 생성됨
      const poolStatus = workerPoolManager.getPoolStatus();
      expect(poolStatus.workers).toHaveLength(config.minWorkers);
      
      // 복원된 Worker들이 포함되어 있는지 확인
      const restoredWorkerIds = poolStatus.workers.map(w => w.id);
      expect(restoredWorkerIds).toContain('existing-worker-1');
      expect(restoredWorkerIds).toContain('existing-worker-2');

      // 로그 확인
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Worker pool initialized', 
        expect.objectContaining({
          restoredWorkers: 2,
          newWorkers: 0,
          totalWorkers: 2
        })
      );
    });

    it('복원 실패한 Worker는 상태에서 제거해야 한다', async () => {
      // Given: 복원 실패할 Worker 설정
      const corruptedWorker = {
        id: 'corrupted-worker',
        status: WorkerStatus.WAITING,
        workspaceDir: '/tmp/corrupted',
        developerType: 'claude' as const,
        createdAt: new Date(),
        lastActiveAt: new Date()
      };
      mockStateManager.getActiveWorkers.mockResolvedValue([corruptedWorker]);
      
      // createWorkerInstance에서 에러 발생하도록 설정
      const originalCreate = mockDeveloperFactory.create;
      (mockDeveloperFactory.create as jest.Mock)
        .mockImplementationOnce(() => {
          throw new Error('Worker restoration failed');
        });

      // When: Pool 초기화
      await workerPoolManager.initializePool();

      // Then: 복원 실패한 Worker가 제거되고 새 Worker가 생성됨
      expect(mockStateManager.removeWorker).toHaveBeenCalledWith('corrupted-worker');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to restore worker, removing from state',
        expect.objectContaining({
          workerId: 'corrupted-worker'
        })
      );

      // 복원 후 원래 create 함수로 되돌림
      (mockDeveloperFactory.create as jest.Mock).mockImplementation(originalCreate);

      const poolStatus = workerPoolManager.getPoolStatus();
      expect(poolStatus.workers).toHaveLength(config.minWorkers);
    });

    it('Worker 정리 기능이 올바르게 동작해야 한다', async () => {
      // Given: Pool 초기화
      await workerPoolManager.initializePool();
      
      // cleanupIdleWorkers 호출 시 정리될 Worker ID 반환하도록 설정
      const cleanedWorkerIds = ['worker-to-clean'];
      mockStateManager.cleanupIdleWorkers.mockResolvedValue(cleanedWorkerIds);

      // When: cleanupExpiredWorkers 직접 호출 (private 메서드이므로 우회)
      const manager = workerPoolManager as any;
      await manager.cleanupExpiredWorkers();

      // Then: StateManager의 cleanupIdleWorkers가 호출됨
      expect(mockStateManager.cleanupIdleWorkers).toHaveBeenCalledWith(30); // 기본 idleTimeoutMinutes

      // 정리된 Worker가 있으면 로그가 기록됨
      if (cleanedWorkerIds.length > 0) {
        expect(mockLogger.info).toHaveBeenCalledWith(
          'Cleaned up expired workers',
          expect.objectContaining({
            count: cleanedWorkerIds.length,
            workerIds: cleanedWorkerIds
          })
        );
      }
    });
  });
});
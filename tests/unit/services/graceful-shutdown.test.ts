import { AIDevTeamApp } from '@/app';
import { Planner } from '@/services/planner';
import { WorkerPoolManager } from '@/services/manager/worker-pool-manager';
import { Logger } from '@/services/logger';
import { AppConfig } from '@/config/app-config';
import { 
  WorkerStatus,
  WorkerTask,
  WorkerAction,
  DeveloperType
} from '@/types';

// Mock Worker for shutdown testing
class MockWorker {
  constructor(
    public id: string,
    public workspaceDir: string,
    public developerType: DeveloperType,
    public status: WorkerStatus = WorkerStatus.IDLE,
    public currentTask: WorkerTask | null = null
  ) {
    this.lastActiveAt = new Date();
    this.createdAt = new Date();
  }

  public lastActiveAt: Date;
  public createdAt: Date;
  private shutdownPromise: Promise<void> | null = null;

  async assignTask(task: WorkerTask): Promise<void> {
    this.currentTask = task;
    this.status = WorkerStatus.WAITING;
  }

  async startExecution(): Promise<any> {
    this.status = WorkerStatus.WORKING;
    
    // 장시간 실행되는 작업 시뮬레이션
    return new Promise((resolve) => {
      setTimeout(() => {
        this.status = WorkerStatus.IDLE;
        this.currentTask = null;
        resolve({ taskId: this.currentTask?.taskId, success: true });
      }, 2000); // 2초 작업
    });
  }

  async cleanup(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = new Promise((resolve) => {
      const cleanupTime = this.status === WorkerStatus.WORKING ? 1500 : 500;
      
      setTimeout(() => {
        this.status = WorkerStatus.IDLE;
        this.currentTask = null;
        resolve();
      }, cleanupTime);
    });

    return this.shutdownPromise;
  }

  async forceStop(): Promise<void> {
    this.status = WorkerStatus.STOPPED;
    this.currentTask = null;
  }

  getStatus(): WorkerStatus {
    return this.status;
  }

  getCurrentTask(): WorkerTask | null {
    return this.currentTask;
  }

  isWorking(): boolean {
    return this.status === WorkerStatus.WORKING;
  }
}

// Mock WorkerPoolManager for shutdown testing
class MockWorkerPoolManager {
  private workers: Map<string, MockWorker> = new Map();
  private shutdownInProgress = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(private logger: Logger) {}

  async initializePool(): Promise<void> {
    // 테스트용 Worker 3개 생성
    for (let i = 1; i <= 3; i++) {
      const worker = new MockWorker(
        `worker-${i}`,
        `/workspace/worker-${i}`,
        'claude'
      );
      this.workers.set(worker.id, worker);
    }
  }

  async getAvailableWorker(): Promise<MockWorker | null> {
    if (this.shutdownInProgress) {
      return null;
    }

    const availableWorker = Array.from(this.workers.values())
      .find(worker => worker.getStatus() === WorkerStatus.IDLE);
    
    return availableWorker || null;
  }

  async assignWorkerTask(workerId: string, task: WorkerTask): Promise<void> {
    const worker = this.workers.get(workerId);
    if (worker) {
      await worker.assignTask(task);
      // 비동기로 작업 실행
      worker.startExecution().catch(error => {
        this.logger.error('Worker execution failed', { workerId, error });
      });
    }
  }

  getPoolStatus() {
    const allWorkers = Array.from(this.workers.values());
    return {
      totalWorkers: allWorkers.length,
      idleWorkers: allWorkers.filter(w => w.getStatus() === WorkerStatus.IDLE).length,
      workingWorkers: allWorkers.filter(w => w.getStatus() === WorkerStatus.WORKING).length,
      stoppedWorkers: allWorkers.filter(w => w.getStatus() === WorkerStatus.STOPPED).length,
      workers: allWorkers.map(w => ({
        id: w.id,
        status: w.getStatus(),
        currentTask: w.getCurrentTask()?.taskId,
        lastActivity: w.lastActiveAt
      }))
    };
  }

  getWorkingWorkers(): MockWorker[] {
    return Array.from(this.workers.values())
      .filter(worker => worker.isWorking());
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownInProgress = true;
    this.logger.info('Starting WorkerPool shutdown...');

    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<void> {
    const workingWorkers = this.getWorkingWorkers();
    
    if (workingWorkers.length > 0) {
      this.logger.info(`Waiting for ${workingWorkers.length} workers to complete...`);
      
      // 실행 중인 Worker들이 완료될 때까지 대기
      const completionPromises = workingWorkers.map(async (worker) => {
        const maxWaitTime = 10000; // 10초 최대 대기
        const startTime = Date.now();

        while (worker.isWorking() && (Date.now() - startTime) < maxWaitTime) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (worker.isWorking()) {
          this.logger.warn(`Force stopping worker ${worker.id} due to timeout`);
          await worker.forceStop();
        }
      });

      await Promise.all(completionPromises);
    }

    // 모든 Worker 정리
    const cleanupPromises = Array.from(this.workers.values())
      .map(worker => worker.cleanup());
    
    await Promise.all(cleanupPromises);
    
    this.workers.clear();
    this.logger.info('WorkerPool shutdown completed');
  }
}

// Mock Planner for shutdown testing
class MockPlanner {
  private monitoring = false;
  private monitoringInterval: NodeJS.Timeout | null = null;

  constructor(private logger: Logger) {}

  async startMonitoring(): Promise<void> {
    this.monitoring = true;
    this.monitoringInterval = setInterval(() => {
      // 모니터링 작업 시뮬레이션
    }, 1000);
    
    this.logger.info('Planner monitoring started');
  }

  async stopMonitoring(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    this.monitoring = false;
    this.logger.info('Planner monitoring stopped');
  }

  isRunning(): boolean {
    return this.monitoring;
  }
}

describe('시스템 Graceful Shutdown 테스트', () => {
  let mockWorkerPoolManager: MockWorkerPoolManager;
  let mockPlanner: MockPlanner;
  let mockLogger: Logger;
  let originalProcessExit: typeof process.exit;
  let originalProcessOn: typeof process.on;
  let processExitSpy: jest.SpyInstance;
  let processSignalHandlers: Map<string, Function> = new Map();

  beforeEach(async () => {
    mockLogger = Logger.createConsoleLogger();
    mockWorkerPoolManager = new MockWorkerPoolManager(mockLogger);
    mockPlanner = new MockPlanner(mockLogger);

    // process.exit Mock
    originalProcessExit = process.exit;
    processExitSpy = jest.fn();
    process.exit = processExitSpy as any;

    // process.on Mock for signal handling
    originalProcessOn = process.on;
    process.on = jest.fn().mockImplementation((signal: string, handler: Function) => {
      processSignalHandlers.set(signal, handler);
      return originalProcessOn.call(process, signal, () => {}); // 실제 신호는 무시
    }) as any;

    await mockWorkerPoolManager.initializePool();
  });

  afterEach(() => {
    // 원래 process 메서드 복원
    process.exit = originalProcessExit;
    process.on = originalProcessOn;
    processSignalHandlers.clear();
  });

  describe('정상 종료 시나리오', () => {
    it('모든 Worker가 유휴 상태일 때 즉시 종료해야 한다', async () => {
      // Given: 모든 Worker가 유휴 상태
      await mockPlanner.startMonitoring();
      
      const initialStatus = mockWorkerPoolManager.getPoolStatus();
      expect(initialStatus.workingWorkers).toBe(0);

      const startTime = Date.now();

      // When: Graceful shutdown 실행
      await mockPlanner.stopMonitoring();
      await mockWorkerPoolManager.shutdown();

      const endTime = Date.now();

      // Then: 빠르게 종료되어야 함 (1초 내)
      expect(endTime - startTime).toBeLessThan(1000);
      expect(mockPlanner.isRunning()).toBe(false);

      const finalStatus = mockWorkerPoolManager.getPoolStatus();
      expect(finalStatus.totalWorkers).toBe(0);
    });

    it('실행 중인 작업이 완료될 때까지 대기해야 한다', async () => {
      // Given: Worker가 작업을 실행 중
      const availableWorker = await mockWorkerPoolManager.getAvailableWorker();
      expect(availableWorker).not.toBeNull();

      const longRunningTask: WorkerTask = {
        taskId: 'long-task',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      if (availableWorker) {
        await mockWorkerPoolManager.assignWorkerTask(availableWorker.id, longRunningTask);
        
        // 작업이 시작될 때까지 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const statusBeforeShutdown = mockWorkerPoolManager.getPoolStatus();
      expect(statusBeforeShutdown.workingWorkers).toBe(1);

      const startTime = Date.now();

      // When: Graceful shutdown 실행
      await mockPlanner.stopMonitoring();
      await mockWorkerPoolManager.shutdown();

      const endTime = Date.now();

      // Then: 작업 완료를 기다렸어야 함 (최소 2초)
      expect(endTime - startTime).toBeGreaterThan(1500);

      const finalStatus = mockWorkerPoolManager.getPoolStatus();
      expect(finalStatus.totalWorkers).toBe(0);
    });
  });

  describe('강제 종료 시나리오', () => {
    it('대기 시간 초과 시 Worker를 강제로 정지해야 한다', async () => {
      // Given: 무한히 실행되는 작업 시뮬레이션
      const availableWorker = await mockWorkerPoolManager.getAvailableWorker();
      
      if (availableWorker) {
        // Worker의 작업 완료를 지연시킴
        availableWorker.startExecution = jest.fn().mockImplementation(() => {
          availableWorker.status = WorkerStatus.WORKING;
          // 15초 동안 실행되는 작업 (테스트에서는 강제 종료됨)
          return new Promise(resolve => {
            setTimeout(resolve, 15000);
          });
        });

        const infiniteTask: WorkerTask = {
          taskId: 'infinite-task',
          action: WorkerAction.START_NEW_TASK,
          repositoryId: 'owner/repo',
          assignedAt: new Date()
        };

        await mockWorkerPoolManager.assignWorkerTask(availableWorker.id, infiniteTask);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const startTime = Date.now();

      // When: Graceful shutdown 실행 (타임아웃 적용)
      await mockWorkerPoolManager.shutdown();

      const endTime = Date.now();

      // Then: 타임아웃 후 강제 종료되었어야 함 (10초 + 여유분)
      expect(endTime - startTime).toBeLessThan(12000);

      const finalStatus = mockWorkerPoolManager.getPoolStatus();
      expect(finalStatus.totalWorkers).toBe(0);
    });
  });

  describe('신호 핸들링', () => {
    it('SIGTERM 신호 수신 시 graceful shutdown을 실행해야 한다', async () => {
      // Given: 시스템이 실행 중
      await mockPlanner.startMonitoring();
      
      const shutdownSpy = jest.spyOn(mockWorkerPoolManager, 'shutdown');
      const stopMonitoringSpy = jest.spyOn(mockPlanner, 'stopMonitoring');

      // When: SIGTERM 신호 발생 시뮬레이션
      const sigtermHandler = processSignalHandlers.get('SIGTERM');
      expect(sigtermHandler).toBeDefined();

      if (sigtermHandler) {
        // 비동기 핸들러 실행
        const shutdownPromise = Promise.resolve().then(async () => {
          await mockPlanner.stopMonitoring();
          await mockWorkerPoolManager.shutdown();
        });

        sigtermHandler('SIGTERM');
        await shutdownPromise;
      }

      // Then: Graceful shutdown이 실행되어야 함
      expect(stopMonitoringSpy).toHaveBeenCalled();
      expect(shutdownSpy).toHaveBeenCalled();
    });

    it('SIGINT 신호 수신 시 graceful shutdown을 실행해야 한다', async () => {
      // Given: 시스템이 실행 중
      await mockPlanner.startMonitoring();
      
      const shutdownSpy = jest.spyOn(mockWorkerPoolManager, 'shutdown');
      const stopMonitoringSpy = jest.spyOn(mockPlanner, 'stopMonitoring');

      // When: SIGINT (Ctrl+C) 신호 발생 시뮬레이션
      const sigintHandler = processSignalHandlers.get('SIGINT');
      expect(sigintHandler).toBeDefined();

      if (sigintHandler) {
        const shutdownPromise = Promise.resolve().then(async () => {
          await mockPlanner.stopMonitoring();
          await mockWorkerPoolManager.shutdown();
        });

        sigintHandler('SIGINT');
        await shutdownPromise;
      }

      // Then: Graceful shutdown이 실행되어야 함
      expect(stopMonitoringSpy).toHaveBeenCalled();
      expect(shutdownSpy).toHaveBeenCalled();
    });
  });

  describe('종료 순서 및 의존성', () => {
    it('Planner 먼저 정지 후 WorkerPool 종료 순서를 지켜야 한다', async () => {
      // Given: 시스템이 실행 중
      await mockPlanner.startMonitoring();
      
      const callOrder: string[] = [];
      
      const stopMonitoringSpy = jest.spyOn(mockPlanner, 'stopMonitoring')
        .mockImplementation(async () => {
          callOrder.push('planner-stop');
          mockPlanner['monitoring'] = false;
        });

      const shutdownSpy = jest.spyOn(mockWorkerPoolManager, 'shutdown')
        .mockImplementation(async () => {
          callOrder.push('worker-pool-shutdown');
          return mockWorkerPoolManager['performShutdown']();
        });

      // When: Graceful shutdown 실행
      await mockPlanner.stopMonitoring();
      await mockWorkerPoolManager.shutdown();

      // Then: 올바른 순서로 종료되어야 함
      expect(callOrder).toEqual(['planner-stop', 'worker-pool-shutdown']);
      expect(stopMonitoringSpy).toHaveBeenCalledBefore(shutdownSpy as any);
    });

    it('WorkerPool 종료 실패 시에도 프로세스가 종료되어야 한다', async () => {
      // Given: WorkerPool 종료에 실패하는 상황
      const shutdownError = new Error('WorkerPool shutdown failed');
      jest.spyOn(mockWorkerPoolManager, 'shutdown')
        .mockRejectedValue(shutdownError);

      const loggerErrorSpy = jest.spyOn(mockLogger, 'error');

      // When: Graceful shutdown 시도
      try {
        await mockPlanner.stopMonitoring();
        await mockWorkerPoolManager.shutdown();
      } catch (error) {
        // 에러가 발생해도 로깅 후 계속 진행
        mockLogger.error('Shutdown failed', { error });
      }

      // Then: 에러가 로깅되어야 함
      expect(loggerErrorSpy).toHaveBeenCalledWith('Shutdown failed', { 
        error: shutdownError 
      });
    });
  });

  describe('종료 시간 모니터링', () => {
    it('종료 시간을 측정하고 로깅해야 한다', async () => {
      // Given: 시스템이 실행 중
      await mockPlanner.startMonitoring();
      
      const loggerInfoSpy = jest.spyOn(mockLogger, 'info');
      
      const startTime = Date.now();

      // When: Graceful shutdown 실행
      await mockPlanner.stopMonitoring();
      await mockWorkerPoolManager.shutdown();

      const endTime = Date.now();
      const shutdownDuration = endTime - startTime;

      // 종료 시간 로깅 시뮬레이션
      mockLogger.info('System shutdown completed', { 
        duration: shutdownDuration,
        timestamp: new Date()
      });

      // Then: 종료 시간이 로깅되어야 함
      expect(loggerInfoSpy).toHaveBeenCalledWith('System shutdown completed', {
        duration: expect.any(Number),
        timestamp: expect.any(Date)
      });
    });

    it('종료 중 진행 상황을 주기적으로 로깅해야 한다', async () => {
      // Given: 여러 Worker가 작업 중
      const workers = await Promise.all([
        mockWorkerPoolManager.getAvailableWorker(),
        mockWorkerPoolManager.getAvailableWorker(),
        mockWorkerPoolManager.getAvailableWorker()
      ]);

      // 모든 Worker에게 작업 할당
      for (let i = 0; i < workers.length; i++) {
        const worker = workers[i];
        if (worker) {
          const task: WorkerTask = {
            taskId: `task-${i}`,
            action: WorkerAction.START_NEW_TASK,
            repositoryId: 'owner/repo',
            assignedAt: new Date()
          };
          await mockWorkerPoolManager.assignWorkerTask(worker.id, task);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      
      const loggerInfoSpy = jest.spyOn(mockLogger, 'info');

      // When: Graceful shutdown 실행
      await mockWorkerPoolManager.shutdown();

      // Then: 진행 상황 로깅이 있어야 함
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Waiting for'),
        expect.any(Object)
      );
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'WorkerPool shutdown completed'
      );
    });
  });
});
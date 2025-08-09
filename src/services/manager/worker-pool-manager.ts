import { 
  WorkerPoolManagerInterface,
  WorkspaceManagerInterface,
  ManagerServiceConfig,
  ManagerError
} from '@/types/manager.types';
import { Worker as WorkerType, WorkerPool, WorkerStatus, WorkerUpdate } from '@/types/worker.types';
import { DeveloperConfig, DeveloperType } from '@/types/developer.types';
import { Worker } from '../worker/worker';
import { WorkspaceSetup } from '../worker/workspace-setup';
import { PromptGenerator } from '../worker/prompt-generator';
import { ResultProcessor } from '../worker/result-processor';
import { DeveloperFactory } from '../developer/developer-factory';
import { Logger } from '../logger';
import { StateManager } from '../state-manager';

interface WorkerPoolManagerDependencies {
  readonly logger: Logger;
  readonly stateManager: StateManager;
  readonly workspaceManager?: WorkspaceManagerInterface;
  readonly developerConfig: DeveloperConfig;
}

export class WorkerPoolManager implements WorkerPoolManagerInterface {
  private workers: Map<string, WorkerType> = new Map();
  private workerInstances: Map<string, Worker> = new Map();
  private isInitialized = false;
  private errors: ManagerError[] = [];
  private cleanupTimer: NodeJS.Timeout | null = null;
  
  // Worker 생명주기 설정
  private readonly lifecycleConfig: {
    idleTimeoutMinutes: number;
    cleanupIntervalMinutes: number;
    minPersistentWorkers: number;
  };

  constructor(
    private readonly config: ManagerServiceConfig,
    private readonly dependencies: WorkerPoolManagerDependencies
  ) {
    // 설정에서 lifecycle 정책 읽어오기
    this.lifecycleConfig = {
      idleTimeoutMinutes: config.workerLifecycle?.idleTimeoutMinutes ?? 30,
      cleanupIntervalMinutes: config.workerLifecycle?.cleanupIntervalMinutes ?? 60,
      minPersistentWorkers: config.workerLifecycle?.minPersistentWorkers ?? 1
    };
  }

  async initializePool(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      this.dependencies.logger.info('Initializing worker pool', {
        minWorkers: this.config.minWorkers,
        maxWorkers: this.config.maxWorkers
      });

      // 1. 기존 활성 Worker 복원 시도
      let restoredWorkerCount = 0;
      try {
        const activeWorkers = await this.dependencies.stateManager.getActiveWorkers();
        this.dependencies.logger.info('Found active workers to restore', {
          count: activeWorkers.length
        });

        for (const savedWorker of activeWorkers) {
          try {
            // WorkerInstance 재생성 시도
            const workerInstance = this.createWorkerInstance(savedWorker);
            
            this.workers.set(savedWorker.id, savedWorker);
            this.workerInstances.set(savedWorker.id, workerInstance);
            restoredWorkerCount++;
            
            this.dependencies.logger.debug('Worker restored successfully', {
              workerId: savedWorker.id,
              status: savedWorker.status,
              taskId: savedWorker.currentTask?.taskId
            });
          } catch (error) {
            // 복원 실패한 Worker는 상태에서 제거
            this.dependencies.logger.warn('Failed to restore worker, removing from state', {
              workerId: savedWorker.id,
              error
            });
            await this.dependencies.stateManager.removeWorker(savedWorker.id);
          }
        }
      } catch (error) {
        this.dependencies.logger.warn('Failed to load active workers', { error });
      }

      // 2. 부족한 Worker 수만큼 새로 생성
      const neededWorkers = Math.max(0, this.config.minWorkers - restoredWorkerCount);
      for (let i = 0; i < neededWorkers; i++) {
        const worker = this.createWorker();
        const workerInstance = this.createWorkerInstance(worker);
        
        this.workers.set(worker.id, worker);
        this.workerInstances.set(worker.id, workerInstance);
        await this.dependencies.stateManager.saveWorker(worker);
      }

      // 3. 정리 타이머 시작
      this.startCleanupTimer();

      this.isInitialized = true;
      
      this.dependencies.logger.info('Worker pool initialized', {
        minWorkers: this.config.minWorkers,
        maxWorkers: this.config.maxWorkers,
        restoredWorkers: restoredWorkerCount,
        newWorkers: neededWorkers,
        totalWorkers: this.workers.size
      });

    } catch (error) {
      const managerError: ManagerError = {
        message: error instanceof Error ? error.message : 'Worker pool initialization failed',
        code: 'WORKER_POOL_INIT_ERROR',
        timestamp: new Date(),
        context: { error }
      };
      
      this.errors.push(managerError);
      this.dependencies.logger.error('Worker pool initialization failed', { error: managerError });
      throw error;
    }
  }

  async getAvailableWorker(): Promise<WorkerType | null> {
    // Worker 인스턴스의 상태를 신뢰할 수 있는 소스로 사용
    const availableWorkers: WorkerType[] = [];
    
    for (const [workerId, worker] of this.workers) {
      const workerInstance = this.workerInstances.get(workerId);
      if (workerInstance && workerInstance.getStatus() === WorkerStatus.IDLE) {
        availableWorkers.push(worker);
      }
    }

    if (availableWorkers.length === 0) {
      // 최대 Worker 수 미만이면 새 Worker 생성 시도
      if (this.workers.size < this.config.maxWorkers) {
        const newWorker = this.createWorker();
        const newWorkerInstance = this.createWorkerInstance(newWorker);
        
        this.workers.set(newWorker.id, newWorker);
        this.workerInstances.set(newWorker.id, newWorkerInstance);
        await this.dependencies.stateManager.saveWorker(newWorker);
        return newWorker;
      }
      return null;
    }

    return availableWorkers[0] || null;
  }

  async assignWorker(workerId: string, taskId: string): Promise<void> {
    // 레거시 메서드 - 호환성을 위해 유지하되 내부적으로 assignWorkerTask 호출
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    // 기본 WorkerTask 객체 생성 (제한된 정보만 포함)
    const basicTask = {
      taskId,
      action: 'start_new_task' as any,
      assignedAt: new Date(),
      repositoryId: 'unknown' // 레거시 호환성을 위한 기본값
    };

    await this.assignWorkerTask(workerId, basicTask);
  }

  async assignWorkerTask(workerId: string, task: any): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    // Worker 인스턴스 상태 확인
    const workerInstance = this.workerInstances.get(workerId);
    if (!workerInstance) {
      throw new Error(`Worker instance not found: ${workerId}`);
    }

    // Worker 인스턴스의 현재 상태 확인
    const currentStatus = workerInstance.getStatus();
    if (currentStatus !== WorkerStatus.IDLE) {
      throw new Error(`Worker ${workerId} is not available (status: ${currentStatus})`);
    }

    // 이전 상태 백업 (롤백용)
    const previousWorker = { ...worker };

    try {
      // 1. 먼저 Worker 인스턴스에 작업 할당 시도
      await workerInstance.assignTask(task);

      // 2. 성공한 경우에만 workers Map 업데이트
      const updatedWorker: WorkerType = {
        ...worker,
        status: WorkerStatus.WAITING,
        currentTask: task,
        lastActiveAt: new Date()
      };

      this.workers.set(workerId, updatedWorker);
      await this.dependencies.stateManager.saveWorker(updatedWorker);

      this.dependencies.logger.info('Worker assigned to task', {
        workerId,
        taskId: task.taskId,
        action: task.action,
        repositoryId: task.repositoryId
      });
    } catch (error) {
      // 롤백: Worker 상태 복원
      this.workers.set(workerId, previousWorker);
      await this.dependencies.stateManager.saveWorker(previousWorker);

      this.dependencies.logger.error('Failed to assign task to worker', {
        workerId,
        taskId: task.taskId,
        error
      });

      throw error;
    }
  }

  async releaseWorker(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    const workerType = worker.workerType || 'pool';
    const { currentTask } = worker;

    if (workerType === 'temporary') {
      // 임시 Worker: 즉시 삭제
      const workerInstance = this.workerInstances.get(workerId);
      if (workerInstance) {
        try {
          await workerInstance.cleanup();
        } catch (error) {
          this.dependencies.logger.warn('Failed to cleanup temporary worker instance', {
            workerId,
            error
          });
        }
      }
      
      this.workers.delete(workerId);
      this.workerInstances.delete(workerId);
      await this.dependencies.stateManager.removeWorker(workerId);
      
      this.dependencies.logger.info('Temporary worker removed', {
        workerId,
        previousTaskId: currentTask?.taskId
      });
    } else {
      // 풀 Worker: IDLE 상태로 변경 (나중에 정리 타이머가 처리)
      const { currentTask: _, ...workerWithoutTask } = worker;
      const updatedWorker: WorkerType = {
        ...workerWithoutTask,
        status: WorkerStatus.IDLE,
        lastActiveAt: new Date()
      };

      this.workers.set(workerId, updatedWorker);
      await this.dependencies.stateManager.saveWorker(updatedWorker);

      this.dependencies.logger.info('Pool worker released to idle', {
        workerId,
        previousTaskId: currentTask?.taskId,
        willCleanupAfter: `${this.lifecycleConfig.idleTimeoutMinutes} minutes`
      });
    }
  }

  async getWorkerByTaskId(taskId: string): Promise<WorkerType | null> {
    // Worker 인스턴스에서 현재 작업 확인
    for (const [workerId, workerInstance] of this.workerInstances) {
      const currentTask = workerInstance.getCurrentTask();
      if (currentTask?.taskId === taskId) {
        return this.workers.get(workerId) || null;
      }
    }
    return null;
  }

  async getWorkerInstance(workerId: string, pullRequestService?: any): Promise<Worker | null> {
    return this.workerInstances.get(workerId) || null;
  }

  async updateWorkerStatus(workerId: string, status: WorkerStatus): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    const updatedWorker: WorkerType = {
      ...worker,
      status,
      lastActiveAt: new Date()
    };

    this.workers.set(workerId, updatedWorker);
    await this.dependencies.stateManager.saveWorker(updatedWorker);

    this.dependencies.logger.debug('Worker status updated', {
      workerId,
      status
    });
  }

  async recoverStoppedWorkers(): Promise<void> {
    const stoppedWorkers = Array.from(this.workers.values())
      .filter(worker => worker.status === WorkerStatus.STOPPED);

    const now = Date.now();
    const recoveredWorkers: string[] = [];

    for (const worker of stoppedWorkers) {
      const timeSinceLastActive = now - worker.lastActiveAt.getTime();
      
      if (timeSinceLastActive >= this.config.workerRecoveryTimeoutMs) {
        const updatedWorker: WorkerType = {
          ...worker,
          status: WorkerStatus.WAITING,
          lastActiveAt: new Date()
        };

        this.workers.set(worker.id, updatedWorker);
        await this.dependencies.stateManager.saveWorker(updatedWorker);
        
        recoveredWorkers.push(worker.id);
        
        this.dependencies.logger.info('Worker recovered from stopped state', {
          workerId: worker.id
        });
      }
    }

    if (recoveredWorkers.length > 0) {
      this.dependencies.logger.info('Worker recovery completed', {
        recoveredCount: recoveredWorkers.length,
        recoveredWorkers
      });
    }
  }

  getPoolStatus(): WorkerPool {
    const workers = Array.from(this.workers.values());
    const activeWorkers = workers.filter(
      worker => worker.status === WorkerStatus.WORKING
    ).length;
    const idleWorkers = workers.filter(
      worker => worker.status === WorkerStatus.IDLE
    ).length;
    const stoppedWorkers = workers.filter(
      worker => worker.status === WorkerStatus.STOPPED
    ).length;

    return {
      workers,
      minWorkers: this.config.minWorkers,
      maxWorkers: this.config.maxWorkers,
      activeWorkers,
      idleWorkers,
      stoppedWorkers,
      totalWorkers: workers.length
    };
  }

  // Worker 생명주기 관리 메서드들
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    const intervalMs = this.lifecycleConfig.cleanupIntervalMinutes * 60 * 1000;
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredWorkers().catch(error => {
        this.dependencies.logger.error('Failed to cleanup expired workers', { error });
      });
    }, intervalMs);
    
    this.dependencies.logger.debug('Cleanup timer started', {
      intervalMinutes: this.lifecycleConfig.cleanupIntervalMinutes
    });
  }

  private async cleanupExpiredWorkers(): Promise<void> {
    try {
      // StateManager를 통해 IDLE 상태의 오래된 Worker들 정리
      const cleanedWorkerIds = await this.dependencies.stateManager.cleanupIdleWorkers(
        this.lifecycleConfig.idleTimeoutMinutes
      );
      
      // 로컬 맵에서도 제거
      for (const workerId of cleanedWorkerIds) {
        const workerInstance = this.workerInstances.get(workerId);
        if (workerInstance) {
          try {
            await workerInstance.cleanup();
          } catch (error) {
            this.dependencies.logger.warn('Failed to cleanup worker instance', {
              workerId,
              error
            });
          }
        }
        
        this.workers.delete(workerId);
        this.workerInstances.delete(workerId);
      }
      
      if (cleanedWorkerIds.length > 0) {
        this.dependencies.logger.info('Cleaned up expired workers', {
          count: cleanedWorkerIds.length,
          workerIds: cleanedWorkerIds
        });
      }
    } catch (error) {
      this.dependencies.logger.error('Failed to cleanup expired workers', { error });
    }
  }

  async shutdown(): Promise<void> {
    this.dependencies.logger.info('Shutting down worker pool');
    
    // 정리 타이머 중지
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    // 모든 Worker 인스턴스 정리
    for (const [workerId, workerInstance] of this.workerInstances) {
      try {
        await workerInstance.cleanup();
      } catch (error) {
        this.dependencies.logger.warn('Failed to cleanup worker instance', {
          workerId,
          error
        });
      }
    }
    
    // 모든 Worker 정리
    this.workers.clear();
    this.workerInstances.clear();
    this.isInitialized = false;
    
    this.dependencies.logger.info('Worker pool shutdown completed');
  }

  private createWorker(workerType: 'pool' | 'temporary' = 'pool'): WorkerType {
    const workerId = this.generateWorkerId();
    
    return {
      id: workerId,
      status: WorkerStatus.IDLE,
      workspaceDir: `${this.config.workspaceBasePath}/${workerId}`,
      developerType: 'claude', // 기본값, 향후 설정 가능하도록 확장
      createdAt: new Date(),
      lastActiveAt: new Date(),
      workerType
    };
  }

  private createWorkerInstance(worker: WorkerType): Worker {
    // 실제 Developer 인스턴스 생성
    const developer = DeveloperFactory.create(
      worker.developerType,
      this.dependencies.developerConfig,
      { logger: this.dependencies.logger }
    );

    // Worker 의존성 생성
    const dependencies = {
      logger: this.dependencies.logger,
      workspaceSetup: new WorkspaceSetup({
        logger: this.dependencies.logger,
        workspaceManager: this.dependencies.workspaceManager || null
      }),
      promptGenerator: new PromptGenerator({
        logger: this.dependencies.logger
      }),
      resultProcessor: new ResultProcessor({
        logger: this.dependencies.logger
      }),
      developer
    };

    return new Worker(
      worker.id,
      worker.workspaceDir,
      worker.developerType,
      dependencies
    );
  }

  private generateWorkerId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `worker-${timestamp}-${random}`;
  }
}
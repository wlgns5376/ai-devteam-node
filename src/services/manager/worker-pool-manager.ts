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

  constructor(
    private readonly config: ManagerServiceConfig,
    private readonly dependencies: WorkerPoolManagerDependencies
  ) {}

  async initializePool(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      this.dependencies.logger.info('Initializing worker pool', {
        minWorkers: this.config.minWorkers,
        maxWorkers: this.config.maxWorkers
      });

      // 최소 Worker 수만큼 생성
      for (let i = 0; i < this.config.minWorkers; i++) {
        const worker = this.createWorker();
        const workerInstance = this.createWorkerInstance(worker);
        
        this.workers.set(worker.id, worker);
        this.workerInstances.set(worker.id, workerInstance);
        await this.dependencies.stateManager.saveWorker(worker);
      }

      this.isInitialized = true;
      
      this.dependencies.logger.info('Worker pool initialized', {
        minWorkers: this.config.minWorkers,
        maxWorkers: this.config.maxWorkers
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
    const availableWorkers = Array.from(this.workers.values())
      .filter(worker => worker.status === WorkerStatus.IDLE);

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

    // Worker 인스턴스에 작업 할당
    try {
      const workerInstance = this.workerInstances.get(workerId);
      if (workerInstance) {
        await workerInstance.assignTask(task);
      }
    } catch (error) {
      this.dependencies.logger.warn('Failed to assign task to worker instance', {
        workerId,
        taskId: task.taskId,
        error
      });
    }
  }

  async releaseWorker(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    const { currentTask, ...workerWithoutTask } = worker;
    const updatedWorker: WorkerType = {
      ...workerWithoutTask,
      status: WorkerStatus.IDLE,
      lastActiveAt: new Date()
    };

    this.workers.set(workerId, updatedWorker);
    await this.dependencies.stateManager.saveWorker(updatedWorker);

    this.dependencies.logger.info('Worker released', {
      workerId,
      previousTaskId: currentTask?.taskId
    });
  }

  async getWorkerByTaskId(taskId: string): Promise<WorkerType | null> {
    for (const worker of this.workers.values()) {
      if (worker.currentTask?.taskId === taskId) {
        return worker;
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

    return {
      workers,
      minWorkers: this.config.minWorkers,
      maxWorkers: this.config.maxWorkers,
      activeWorkers
    };
  }

  async shutdown(): Promise<void> {
    this.dependencies.logger.info('Shutting down worker pool');
    
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

  private createWorker(): WorkerType {
    const workerId = this.generateWorkerId();
    
    return {
      id: workerId,
      status: WorkerStatus.IDLE,
      workspaceDir: `${this.config.workspaceBasePath}/${workerId}`,
      developerType: 'claude', // 기본값, 향후 설정 가능하도록 확장
      createdAt: new Date(),
      lastActiveAt: new Date()
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
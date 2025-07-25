import { 
  WorkerPoolManagerInterface,
  ManagerServiceConfig,
  ManagerError
} from '@/types/manager.types';
import { Worker, WorkerPool, WorkerStatus, WorkerUpdate } from '@/types/worker.types';
import { Logger } from '../logger';
import { StateManager } from '../state-manager';

interface WorkerPoolManagerDependencies {
  readonly logger: Logger;
  readonly stateManager: StateManager;
}

export class WorkerPoolManager implements WorkerPoolManagerInterface {
  private workers: Map<string, Worker> = new Map();
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
        this.workers.set(worker.id, worker);
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

  async getAvailableWorker(): Promise<Worker | null> {
    const availableWorkers = Array.from(this.workers.values())
      .filter(worker => worker.status === WorkerStatus.IDLE);

    if (availableWorkers.length === 0) {
      // 최대 Worker 수 미만이면 새 Worker 생성 시도
      if (this.workers.size < this.config.maxWorkers) {
        const newWorker = this.createWorker();
        this.workers.set(newWorker.id, newWorker);
        await this.dependencies.stateManager.saveWorker(newWorker);
        return newWorker;
      }
      return null;
    }

    return availableWorkers[0] || null;
  }

  async assignWorker(workerId: string, taskId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    const updatedWorker: Worker = {
      ...worker,
      status: WorkerStatus.WAITING,
      currentTaskId: taskId,
      lastActiveAt: new Date()
    };

    this.workers.set(workerId, updatedWorker);
    await this.dependencies.stateManager.saveWorker(updatedWorker);

    this.dependencies.logger.info('Worker assigned to task', {
      workerId,
      taskId
    });
  }

  async releaseWorker(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    const { currentTaskId, ...workerWithoutTask } = worker;
    const updatedWorker: Worker = {
      ...workerWithoutTask,
      status: WorkerStatus.IDLE,
      lastActiveAt: new Date()
    };

    this.workers.set(workerId, updatedWorker);
    await this.dependencies.stateManager.saveWorker(updatedWorker);

    this.dependencies.logger.info('Worker released', {
      workerId
    });
  }

  async getWorkerByTaskId(taskId: string): Promise<Worker | null> {
    for (const worker of this.workers.values()) {
      if (worker.currentTaskId === taskId) {
        return worker;
      }
    }
    return null;
  }

  async getWorkerInstance(workerId: string, pullRequestService?: any): Promise<any | null> {
    // 실제로는 Worker 인스턴스를 관리해야 하지만, 
    // 현재는 Mock 구현이므로 간단히 처리
    const worker = this.workers.get(workerId);
    if (!worker) {
      return null;
    }

    // Mock Worker 인스턴스 반환
    return {
      getCurrentTask: () => worker.currentTaskId ? { taskId: worker.currentTaskId } : null,
      getStatus: () => worker.status,
      startExecution: async () => {
        // Mock 실행 - 성공적으로 PR 생성
        this.dependencies.logger.info('Mock worker task execution', { workerId, taskId: worker.currentTaskId });
        
        // 1-3초 대기 (작업 시뮬레이션)
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
        
        // 실제로 MockPullRequestService에 PR 생성
        let prUrl: string;
        if (pullRequestService) {
          const pr = await pullRequestService.createPullRequest('example/repo', {
            title: `Fix: Complete task ${worker.currentTaskId}`,
            description: `This PR completes the task ${worker.currentTaskId} assigned to worker ${workerId}`,
            sourceBranch: `feature/task-${worker.currentTaskId}`,
            targetBranch: 'main',
            author: 'ai-worker'
          });
          prUrl = pr.url;
          this.dependencies.logger.info('Created PR in MockPullRequestService', { 
            workerId, 
            taskId: worker.currentTaskId, 
            prId: pr.id,
            prUrl: pr.url 
          });
        } else {
          prUrl = `https://github.com/example/repo/pull/${Math.floor(Math.random() * 1000) + 1}`;
        }
        
        return {
          success: true,
          pullRequestUrl: prUrl
        };
      }
    };
  }

  async updateWorkerStatus(workerId: string, status: WorkerStatus): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    const updatedWorker: Worker = {
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
        const updatedWorker: Worker = {
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
    
    // 모든 Worker 정리
    this.workers.clear();
    this.isInitialized = false;
    
    this.dependencies.logger.info('Worker pool shutdown completed');
  }

  private createWorker(): Worker {
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

  private generateWorkerId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `worker-${timestamp}-${random}`;
  }
}
import { 
  WorkerPoolManagerInterface,
  WorkspaceManagerInterface,
  ManagerServiceConfig,
  ManagerError
} from '@/types/manager.types';
import { Worker as WorkerType, WorkerPool, WorkerStatus, WorkerUpdate, WorkerAction } from '@/types/worker.types';
import { DeveloperConfig, DeveloperType } from '@/types/developer.types';
import { Worker } from '../worker/worker';
import { WorkspaceSetup } from '../worker/workspace-setup';
import { PromptGenerator } from '../worker/prompt-generator';
import { ResultProcessor } from '../worker/result-processor';
import { DeveloperFactory } from '../developer/developer-factory';
import { Logger } from '../logger';
import { StateManager } from '../state-manager';
import { TaskAssignmentValidator } from '../worker/task-assignment-validator';

interface WorkerPoolManagerDependencies {
  readonly logger: Logger;
  readonly stateManager: StateManager;
  readonly workspaceManager?: WorkspaceManagerInterface;
  readonly developerConfig: DeveloperConfig;
  readonly developerFactory?: typeof DeveloperFactory;
}

export class WorkerPoolManager implements WorkerPoolManagerInterface {
  private workers: Map<string, WorkerType> = new Map();
  private workerInstances: Map<string, Worker> = new Map();
  private completedTaskResults: Map<string, { success: boolean; pullRequestUrl?: string; completedAt: Date }> = new Map();
  private isInitialized = false;
  private errors: ManagerError[] = [];
  private cleanupTimer: NodeJS.Timeout | null = null;
  private workerAllocationLock: Map<string, Promise<void>> = new Map();
  private taskAssignmentValidator: TaskAssignmentValidator;
  
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

    // TaskAssignmentValidator 초기화
    this.taskAssignmentValidator = new TaskAssignmentValidator({
      logger: this.dependencies.logger,
      workspaceManager: this.dependencies.workspaceManager
    });
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
    // Worker 할당 동시성 문제를 방지하기 위한 락 메커니즘
    const lockKey = 'worker_allocation';
    
    // 이미 락이 걸린 경우 해당 락이 해제될 때까지 대기
    while (this.workerAllocationLock.has(lockKey)) {
      await this.workerAllocationLock.get(lockKey);
    }
    
    // 새로운 락 생성
    let resolveLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.workerAllocationLock.set(lockKey, lockPromise);
    
    try {
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
          this.dependencies.logger.debug('Creating new worker for concurrent request', {
            currentWorkerCount: this.workers.size,
            maxWorkers: this.config.maxWorkers
          });
          
          const newWorker = this.createWorker();
          const newWorkerInstance = this.createWorkerInstance(newWorker);
          
          this.workers.set(newWorker.id, newWorker);
          this.workerInstances.set(newWorker.id, newWorkerInstance);
          await this.dependencies.stateManager.saveWorker(newWorker);
          
          this.dependencies.logger.info('New worker created for concurrent processing', {
            workerId: newWorker.id,
            totalWorkers: this.workers.size
          });
          
          return newWorker;
        }
        return null;
      }

      const selectedWorker = availableWorkers[0] || null;
      
      if (selectedWorker) {
        this.dependencies.logger.debug('Worker allocated with concurrency protection', {
          workerId: selectedWorker.id,
          availableWorkersCount: availableWorkers.length
        });
      }
      
      return selectedWorker;
      
    } finally {
      // 락 해제
      this.workerAllocationLock.delete(lockKey);
      resolveLock!();
    }
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
    const jsonStatus = worker.status;
    
    // 상태 동기화 검증 및 로깅
    this.dependencies.logger.debug('Worker status verification', {
      workerId,
      jsonStatus,
      instanceStatus: currentStatus,
      taskAction: task.action,
      isStatusSynced: jsonStatus === currentStatus
    });
    
    // 상태 불일치 감지 시 경고
    if (jsonStatus !== currentStatus) {
      this.dependencies.logger.warn('Worker state mismatch detected', {
        workerId,
        jsonStatus,
        instanceStatus: currentStatus,
        taskAction: task.action
      });
    }
    
    // 작업 액션에 따른 상태 검증
    const isNewTaskAction = task.action === WorkerAction.START_NEW_TASK;
    const isFeedbackAction = task.action === WorkerAction.PROCESS_FEEDBACK;
    const isResumeAction = task.action === WorkerAction.RESUME_TASK;
    const isMergeAction = task.action === WorkerAction.MERGE_REQUEST;
    
    if (isNewTaskAction && currentStatus !== WorkerStatus.IDLE) {
      throw new Error(`Worker ${workerId} is not available for new task (status: ${currentStatus})`);
    }
    
    // RESUME_TASK는 IDLE 또는 WAITING 상태에서 허용 (Worker 클래스와 일치)
    if (isResumeAction && 
        currentStatus !== WorkerStatus.WAITING && 
        currentStatus !== WorkerStatus.ERROR && 
        currentStatus !== WorkerStatus.IDLE) {
      throw new Error(`Worker ${workerId} is not available for ${task.action} (status: ${currentStatus})`);
    }
    
    // FEEDBACK 및 MERGE 작업은 WAITING 상태에서만 허용
    if ((isFeedbackAction || isMergeAction) && 
        currentStatus !== WorkerStatus.WAITING) {
      throw new Error(`Worker ${workerId} is not available for ${task.action} (status: ${currentStatus})`);
    }
    
    if (currentStatus === WorkerStatus.WORKING) {
      throw new Error(`Worker ${workerId} is currently working (status: ${currentStatus})`);
    }
    
    if (currentStatus === WorkerStatus.STOPPED) {
      throw new Error(`Worker ${workerId} is stopped (status: ${currentStatus})`);
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

  async recoverErrorWorkers(): Promise<void> {
    const errorWorkers = Array.from(this.workers.values())
      .filter(worker => worker.status === WorkerStatus.ERROR);

    const now = Date.now();
    const recoveredWorkers: string[] = [];

    for (const worker of errorWorkers) {
      const timeSinceLastActive = now - worker.lastActiveAt.getTime();
      
      // ERROR 상태 복구는 더 짧은 시간 후에 시도 (기본값의 절반)
      const recoveryTimeout = this.config.workerRecoveryTimeoutMs / 2;
      
      if (timeSinceLastActive >= recoveryTimeout) {
        // Worker 인스턴스도 함께 업데이트
        const workerInstance = this.workerInstances.get(worker.id);
        if (workerInstance) {
          await workerInstance.resumeExecution();
        }

        const updatedWorker: WorkerType = {
          ...worker,
          status: WorkerStatus.WAITING,
          lastActiveAt: new Date()
        };

        this.workers.set(worker.id, updatedWorker);
        await this.dependencies.stateManager.saveWorker(updatedWorker);
        
        recoveredWorkers.push(worker.id);
        
        this.dependencies.logger.info('Worker recovered from error state', {
          workerId: worker.id,
          taskId: worker.currentTask?.taskId,
          recoveryTimeout
        });
      }
    }

    if (recoveredWorkers.length > 0) {
      this.dependencies.logger.info('Error worker recovery completed', {
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
    const errorWorkers = workers.filter(
      worker => worker.status === WorkerStatus.ERROR
    ).length;

    return {
      workers,
      minWorkers: this.config.minWorkers,
      maxWorkers: this.config.maxWorkers,
      activeWorkers,
      idleWorkers,
      stoppedWorkers,
      errorWorkers,
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
      // 정리 작업과 복구 작업을 함께 수행
      Promise.all([
        this.cleanupExpiredWorkers().catch(error => {
          this.dependencies.logger.error('Failed to cleanup expired workers', { error });
        }),
        this.recoverStoppedWorkers().catch(error => {
          this.dependencies.logger.error('Failed to recover stopped workers', { error });
        }),
        this.recoverErrorWorkers().catch(error => {
          this.dependencies.logger.error('Failed to recover error workers', { error });
        })
      ]);
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
    
    // // 모든 Worker 인스턴스 정리
    // for (const [workerId, workerInstance] of this.workerInstances) {
    //   try {
    //     await workerInstance.cleanup();
    //   } catch (error) {
    //     this.dependencies.logger.warn('Failed to cleanup worker instance', {
    //       workerId,
    //       error
    //     });
    //   }
    // }
    
    // // 모든 Worker 정리
    // this.workers.clear();
    // this.workerInstances.clear();
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
    const factory = this.dependencies.developerFactory || DeveloperFactory;
    const developer = factory.create(
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

    // Worker 상태를 WorkerStatus enum으로 변환
    const workerStatus = worker.status as WorkerStatus;
    
    return new Worker(
      worker.id,
      worker.workspaceDir,
      worker.developerType,
      dependencies,
      workerStatus,
      worker.currentTask || null
    );
  }

  private generateWorkerId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `worker-${timestamp}-${random}`;
  }

  /**
   * 완료된 작업 결과 저장
   */
  storeTaskResult(taskId: string, result: { success: boolean; pullRequestUrl?: string }): void {
    this.completedTaskResults.set(taskId, {
      ...result,
      completedAt: new Date()
    });
    
    this.dependencies.logger.debug('Task result stored', {
      taskId,
      success: result.success,
      pullRequestUrl: result.pullRequestUrl
    });
  }

  /**
   * 완료된 작업 결과 조회
   */
  getTaskResult(taskId: string): { success: boolean; pullRequestUrl?: string; completedAt: Date } | null {
    return this.completedTaskResults.get(taskId) || null;
  }

  /**
   * 완료된 작업 결과 제거
   */
  clearTaskResult(taskId: string): void {
    this.completedTaskResults.delete(taskId);
  }

  /**
   * 특정 작업을 위한 최적의 Worker를 선택합니다.
   * workspace 존재 여부와 우선순위를 고려하여 선택합니다.
   */
  async getAvailableWorkerForTask(taskId: string, boardItem?: any): Promise<WorkerType | null> {
    // 기존 가용 Worker 찾기
    const availableWorker = await this.getAvailableWorker();
    if (!availableWorker) {
      return null;
    }

    // 작업에 대한 우선순위 평가
    const priority = await this.taskAssignmentValidator.getTaskReassignmentPriority(taskId);
    
    this.dependencies.logger.debug('Worker selected for task with priority', {
      taskId,
      workerId: availableWorker.id,
      priority,
      hasValidWorkspace: priority >= 10
    });

    return availableWorker;
  }

  /**
   * idle 상태의 Worker가 특정 작업에 할당 가능한지 확인합니다.
   */
  async canAssignIdleWorkerToTask(workerId: string, taskId: string, boardItem?: any): Promise<boolean> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return false;
    }

    const workerInstance = this.workerInstances.get(workerId);
    if (!workerInstance || workerInstance.getStatus() !== WorkerStatus.IDLE) {
      return false;
    }

    // workspace 기반 할당 가능성 확인
    const canAssign = await this.taskAssignmentValidator.canAssignToIdleWorker(taskId, workerId, boardItem);
    
    this.dependencies.logger.debug('Idle worker task assignment check', {
      workerId,
      taskId,
      canAssign,
      workerStatus: workerInstance.getStatus()
    });

    return canAssign;
  }

  /**
   * WorkspaceManager 인스턴스를 반환합니다.
   * TaskRequestHandler에서 workspace 검증을 위해 사용됩니다.
   */
  getWorkspaceManager(): WorkspaceManagerInterface | undefined {
    return this.dependencies.workspaceManager;
  }
}
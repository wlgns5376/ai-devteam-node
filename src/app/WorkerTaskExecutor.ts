/**
 * WorkerTaskExecutor - Worker 작업 실행을 담당하는 클래스
 * Worker 상태 관리 및 실행 책임을 분리
 */

import { TaskRequest } from '@/types';
import { WorkerPoolManager } from '../services/manager/worker-pool-manager';
import { PullRequestService } from '../types';
import { Logger } from '../services/logger';

export interface WorkerExecutionResult {
  success: boolean;
  pullRequestUrl?: string;
}

export class WorkerTaskExecutor {
  constructor(
    private readonly workerPoolManager: WorkerPoolManager,
    private readonly logger?: Logger
  ) {}

  /**
   * Worker 작업 실행 및 상태 관리
   */
  async executeWorkerTask(
    workerId: string, 
    request: TaskRequest,
    pullRequestService?: PullRequestService
  ): Promise<WorkerExecutionResult> {
    try {
      // Worker 인스턴스를 가져와서 실제 작업 실행
      const workerInstance = await this.workerPoolManager.getWorkerInstance(workerId, pullRequestService);
      if (!workerInstance) {
        return { success: false };
      }

      // 작업이 이미 할당되어 있다면 상태 확인
      const currentTask = workerInstance.getCurrentTask();
      if (currentTask?.taskId === request.taskId) {
        const workerStatus = workerInstance.getStatus();
        
        this.logger?.info('Checking worker status for task execution', {
          workerId,
          taskId: request.taskId,
          workerStatus,
          action: request.action
        });

        return await this.handleWorkerByStatus(workerInstance, workerId, request, workerStatus);
      }

      this.logger?.warn('Worker task mismatch or invalid state', {
        workerId,
        requestTaskId: request.taskId,
        currentTaskId: currentTask?.taskId,
        workerStatus: workerInstance.getStatus()
      });

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

  /**
   * Worker 상태에 따른 처리
   */
  private async handleWorkerByStatus(
    workerInstance: any,
    workerId: string,
    request: TaskRequest,
    workerStatus: string
  ): Promise<WorkerExecutionResult> {
    switch (workerStatus) {
      case 'working':
        return await this.handleWorkingStatus(workerId, request.taskId);
      
      case 'stopped':
        return await this.handleStoppedStatus(workerInstance, workerId, request.taskId);
      
      case 'waiting':
        return await this.handleWaitingStatus(workerInstance, workerId, request.taskId);
      
      case 'error':
        return await this.handleErrorStatus(workerInstance, workerId, request.taskId);
      
      case 'idle':
        return await this.handleIdleStatus(workerId, request.taskId);
      
      default:
        this.logger?.warn('Unknown worker status', {
          workerId,
          taskId: request.taskId,
          workerStatus
        });
        return { success: false };
    }
  }

  /**
   * 작업 중인 Worker 처리
   */
  private async handleWorkingStatus(workerId: string, taskId: string): Promise<WorkerExecutionResult> {
    this.logger?.info('Worker is already working, waiting for completion', {
      workerId,
      taskId
    });
    return { success: false }; // 아직 진행 중
  }

  /**
   * 중지된 Worker 처리 - 재개
   */
  private async handleStoppedStatus(
    workerInstance: any, 
    workerId: string, 
    taskId: string
  ): Promise<WorkerExecutionResult> {
    this.logger?.info('Resuming stopped worker execution', {
      workerId,
      taskId
    });
    
    try {
      await workerInstance.resumeExecution();
      return { success: false }; // 재개했으므로 계속 진행 중
    } catch (error) {
      this.logger?.error('Failed to resume worker execution', {
        workerId,
        taskId,
        error: error instanceof Error ? error.message : String(error)
      });
      return { success: false };
    }
  }

  /**
   * 오류 상태 Worker 처리 - 재시도 또는 재개
   */
  private async handleErrorStatus(
    workerInstance: any, 
    workerId: string, 
    taskId: string
  ): Promise<WorkerExecutionResult> {
    this.logger?.info('Handling worker in error status', {
      workerId,
      taskId,
      errorCount: workerInstance.errorCount || 0,
      consecutiveErrors: workerInstance.consecutiveErrors || 0
    });
    
    // 백오프 대기 시간 확인
    if (workerInstance.canRetryNow && !workerInstance.canRetryNow()) {
      this.logger?.info('Worker still in backoff period, waiting', {
        workerId,
        taskId,
        lastErrorAt: workerInstance.lastErrorAt
      });
      return { success: false }; // 아직 대기 중
    }
    
    try {
      // ERROR 상태에서 재개 시도
      await workerInstance.resumeExecution();
      this.logger?.info('Worker resumed from error status', {
        workerId,
        taskId
      });
      
      // 재개 후 작업 시작
      const result = await workerInstance.startExecution();
      
      this.logger?.info('Worker execution completed after error recovery', {
        workerId,
        taskId,
        success: result.success,
        pullRequestUrl: result.pullRequestUrl
      });
      
      return {
        success: result.success,
        ...(result.pullRequestUrl && { pullRequestUrl: result.pullRequestUrl })
      };
      
    } catch (error) {
      this.logger?.error('Failed to recover worker from error status', {
        workerId,
        taskId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // 복구 실패 시 Worker 해제
      await this.handleWorkerFailure(workerId, taskId);
      return { success: false };
    }
  }

  /**
   * 대기 중인 Worker 처리 - 작업 시작 또는 완료된 결과 확인
   */
  private async handleWaitingStatus(
    workerInstance: any,
    workerId: string,
    taskId: string
  ): Promise<WorkerExecutionResult> {
    // 먼저 저장된 작업 결과가 있는지 확인 (완료된 작업의 경우)
    const storedResult = this.workerPoolManager.getTaskResult(taskId);
    if (storedResult) {
      this.logger?.info('Found stored task result for waiting worker', {
        workerId,
        taskId,
        success: storedResult.success,
        pullRequestUrl: storedResult.pullRequestUrl
      });
      
      // 결과 사용 후 정리
      this.workerPoolManager.clearTaskResult(taskId);
      
      return {
        success: storedResult.success,
        ...(storedResult.pullRequestUrl && { pullRequestUrl: storedResult.pullRequestUrl })
      };
    }
    
    // 저장된 결과가 없으면 작업 시작
    this.logger?.info('Starting or restarting worker execution', {
      workerId,
      taskId
    });
    
    try {
      const result = await workerInstance.startExecution();
      
      this.logger?.info('Worker execution completed', {
        workerId,
        taskId,
        success: result.success,
        pullRequestUrl: result.pullRequestUrl
      });
      
      return {
        success: result.success,
        ...(result.pullRequestUrl && { pullRequestUrl: result.pullRequestUrl })
      };

    } catch (executionError) {
      this.logger?.error('Worker execution failed', {
        workerId,
        taskId,
        error: executionError instanceof Error ? executionError.message : String(executionError)
      });
      
      // Worker 실패 시 자동으로 해제하여 상태 동기화
      await this.handleWorkerFailure(workerId, taskId);
      return { success: false };
    }
  }

  /**
   * 유휴 상태 Worker 처리 - 완료된 것으로 간주
   */
  private async handleIdleStatus(workerId: string, taskId: string): Promise<WorkerExecutionResult> {
    this.logger?.info('Worker is idle, checking for stored task result', {
      workerId,
      taskId
    });
    
    // 저장된 작업 결과 확인
    const storedResult = this.workerPoolManager.getTaskResult(taskId);
    if (storedResult) {
      this.logger?.info('Found stored task result', {
        workerId,
        taskId,
        success: storedResult.success,
        pullRequestUrl: storedResult.pullRequestUrl
      });
      
      // 결과 사용 후 정리
      this.workerPoolManager.clearTaskResult(taskId);
      
      return {
        success: storedResult.success,
        ...(storedResult.pullRequestUrl && { pullRequestUrl: storedResult.pullRequestUrl })
      };
    }
    
    // 저장된 결과가 없으면 완료된 것으로 간주 (기본 동작)
    return { success: true };
  }

  /**
   * Worker 실패 시 처리
   */
  private async handleWorkerFailure(workerId: string, taskId: string): Promise<void> {
    try {
      await this.workerPoolManager.releaseWorker(workerId);
      this.logger?.info('Worker released after execution failure', {
        workerId,
        taskId
      });
    } catch (releaseError) {
      this.logger?.warn('Failed to release worker after execution failure', {
        workerId,
        error: releaseError instanceof Error ? releaseError.message : String(releaseError)
      });
    }
  }

  /**
   * Worker에 작업 할당 및 즉시 실행
   */
  async assignAndExecuteTask(
    workerId: string,
    task: any,
    pullRequestService?: PullRequestService
  ): Promise<void> {
    // Worker에 작업 할당
    await this.workerPoolManager.assignWorkerTask(workerId, task);

    // 작업 즉시 실행
    const workerInstance = await this.workerPoolManager.getWorkerInstance(workerId, pullRequestService);
    if (workerInstance) {
      // 비동기로 작업 실행 (완료를 기다리지 않음)
      workerInstance.startExecution().then((result: any) => {
        this.logger?.info('Task execution completed', {
          taskId: task.taskId,
          workerId,
          success: result.success,
          pullRequestUrl: result.pullRequestUrl
        });
        
        // 완료된 작업 결과를 WorkerPoolManager에 저장
        this.workerPoolManager.storeTaskResult(task.taskId, {
          success: result.success,
          pullRequestUrl: result.pullRequestUrl
        });
      }).catch((error: any) => {
        this.logger?.error('Task execution failed', {
          taskId: task.taskId,
          workerId,
          error: error instanceof Error ? error.message : String(error)
        });
        
        // 실패한 작업 결과도 저장
        this.workerPoolManager.storeTaskResult(task.taskId, {
          success: false
        });
      });
    }
  }

  /**
   * Worker 해제 (에러 처리 포함)
   */
  async safeReleaseWorker(workerId: string, taskId?: string): Promise<void> {
    if (!workerId) return;

    try {
      await this.workerPoolManager.releaseWorker(workerId);
      this.logger?.info('Worker released successfully', {
        workerId,
        ...(taskId && { taskId })
      });
    } catch (err) {
      this.logger?.error('Failed to release worker', {
        workerId,
        ...(taskId && { taskId }),
        error: err
      });
    }
  }
}
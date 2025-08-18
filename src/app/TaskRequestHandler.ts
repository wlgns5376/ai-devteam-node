/**
 * TaskRequestHandler - 작업 요청 처리를 담당하는 클래스
 * AIDevTeamApp에서 분리된 Task 처리 로직
 */

import { 
  TaskRequest, 
  TaskResponse, 
  ResponseStatus,
  WorkerAction,
  WorkspaceInfo 
} from '@/types';
import { WorkerPoolManager } from '../services/manager/worker-pool-manager';
import { PullRequestService, ProjectBoardService } from '../types';
import { Logger } from '../services/logger';
import { WorkerTaskExecutor } from './WorkerTaskExecutor';
import { TaskAssignmentValidator, TaskReassignmentCheck } from '../services/worker/task-assignment-validator';

export class TaskRequestHandler {
  private readonly workerTaskExecutor: WorkerTaskExecutor;
  private readonly taskAssignmentValidator: TaskAssignmentValidator;

  constructor(
    private readonly workerPoolManager: WorkerPoolManager,
    private readonly projectBoardService?: ProjectBoardService,
    private readonly pullRequestService?: PullRequestService,
    private readonly logger?: Logger,
    private readonly extractRepositoryFromBoardItem?: (boardItem: any, pullRequestUrl?: string) => string
  ) {
    this.workerTaskExecutor = new WorkerTaskExecutor(this.workerPoolManager, this.logger);
    this.taskAssignmentValidator = new TaskAssignmentValidator({
      logger: this.logger || console as any,
      workspaceManager: this.workerPoolManager.getWorkspaceManager()
    });
  }

  async handleTaskRequest(request: TaskRequest): Promise<TaskResponse> {
    try {
      this.logger?.info('Received task request', { 
        taskId: request.taskId, 
        action: request.action 
      });

      switch (request.action) {
        case 'start_new_task':
          return await this.handleStartNewTask(request);
        
        case 'check_status':
          return await this.handleCheckStatus(request);
        
        case 'process_feedback':
          return await this.handleProcessFeedback(request);
        
        case 'request_merge':
          return await this.handleRequestMerge(request);
        
        case 'release_worker':
          return await this.handleReleaseWorker(request);
        
        default:
          return {
            taskId: request.taskId,
            status: ResponseStatus.ERROR,
            message: `Unsupported action: ${request.action}`,
            workerStatus: 'error'
          };
      }

    } catch (error) {
      this.logger?.error('Failed to process task request', { 
        taskId: request.taskId, 
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        taskId: request.taskId,
        status: ResponseStatus.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
        workerStatus: 'error'
      };
    }
  }

  private async handleStartNewTask(request: TaskRequest): Promise<TaskResponse> {
    // 새 작업 시작
    const availableWorker = await this.workerPoolManager.getAvailableWorker();
    if (!availableWorker) {
      return {
        taskId: request.taskId,
        status: ResponseStatus.REJECTED,
        message: 'No available workers',
        workerStatus: 'unavailable'
      };
    }

    // PRD 요구사항에 맞는 전체 작업 정보 생성
    const workerTask = {
      taskId: request.taskId,
      action: 'start_new_task' as any,
      boardItem: request.boardItem,
      repositoryId: this.extractRepositoryFromBoardItem?.(request.boardItem) || 'test-owner/test-repo',
      assignedAt: new Date()
    };

    // 작업 할당 및 즉시 실행 (Planner가 결과를 감지하도록 WorkerTaskExecutor 사용)
    await this.workerTaskExecutor.assignAndExecuteTask(availableWorker.id, workerTask, this.pullRequestService);

    this.logger?.info('Task assigned to worker and started', {
      taskId: request.taskId,
      workerId: availableWorker.id,
      repositoryId: workerTask.repositoryId,
      action: workerTask.action
    });

    return {
      taskId: request.taskId,
      status: ResponseStatus.ACCEPTED,
      message: 'Task assigned to worker and execution started',
      workerStatus: 'assigned'
    };
  }

  private async handleCheckStatus(request: TaskRequest): Promise<TaskResponse> {
    // 작업 상태 확인
    let worker = await this.workerPoolManager.getWorkerByTaskId(request.taskId);
    
    if (!worker) {
      // Worker를 찾지 못한 경우 재할당 시도
      return await this.reassignTask(request);
    }

    // Worker에서 실제 작업 실행 및 결과 확인
    const result = await this.workerTaskExecutor.executeWorkerTask(worker.id, request, this.pullRequestService);
    
    if (result.success && result.pullRequestUrl) {
      // Worker는 해제하지 않음 - 전체 워크플로우 완료 시까지 유지
      // Planner가 IN_REVIEW로 상태 변경 후, 최종 완료 시 RELEASE_WORKER 액션으로 해제
      
      return {
        taskId: request.taskId,
        status: ResponseStatus.COMPLETED,
        message: 'Task completed successfully',
        pullRequestUrl: result.pullRequestUrl,
        workerStatus: 'waiting_for_review'
      };
    } else {
      return {
        taskId: request.taskId,
        status: ResponseStatus.IN_PROGRESS,
        message: 'Task still in progress',
        workerStatus: 'working'
      };
    }
  }

  private async handleProcessFeedback(request: TaskRequest): Promise<TaskResponse> {
    // 피드백 처리
    let worker = await this.workerPoolManager.getWorkerByTaskId(request.taskId);
    let workerId: string;
    
    if (!worker) {
      // 기존 워커가 없으면 새 워커 할당
      const availableWorker = await this.workerPoolManager.getAvailableWorker();
      if (!availableWorker) {
        return {
          taskId: request.taskId,
          status: ResponseStatus.REJECTED,
          message: 'No available workers for feedback processing',
          workerStatus: 'unavailable'
        };
      }
      
      workerId = availableWorker.id;
      
      // 새 워커에 피드백 작업 할당
      const feedbackTask = {
        taskId: request.taskId,
        action: 'process_feedback' as any,
        boardItem: request.boardItem,
        pullRequestUrl: request.pullRequestUrl,
        comments: request.comments,
        repositoryId: request.boardItem ? 
          (this.extractRepositoryFromBoardItem?.(request.boardItem, request.pullRequestUrl) || 'test-owner/test-repo') : 
          'test-owner/test-repo',
        assignedAt: new Date()
      };
      
      await this.workerPoolManager.assignWorkerTask(workerId, feedbackTask);
    } else {
      // 기존 워커가 있으면 재사용
      workerId = worker.id;
      
      // 기존 작업에 피드백 정보 추가
      const feedbackTask = {
        ...worker.currentTask,
        action: 'process_feedback' as any,
        pullRequestUrl: request.pullRequestUrl,
        comments: request.comments,
        assignedAt: new Date()
      };

      // Worker에 피드백 작업 재할당
      await this.workerPoolManager.assignWorkerTask(workerId, feedbackTask);
    }

    // 작업 즉시 실행
    const workerInstance = await this.workerPoolManager.getWorkerInstance(workerId, this.pullRequestService);
    if (workerInstance) {
      // 비동기로 작업 실행 (완료를 기다리지 않음)
      workerInstance.startExecution().then((result) => {
        this.logger?.info('Feedback processing completed', {
          taskId: request.taskId,
          workerId: workerId,
          success: result.success
        });
      }).catch((error) => {
        this.logger?.error('Feedback processing failed', {
          taskId: request.taskId,
          workerId: workerId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }

    this.logger?.info('Feedback task assigned to worker and started', {
      taskId: request.taskId,
      workerId: workerId,
      commentCount: request.comments?.length || 0,
      isNewWorker: !worker
    });

    return {
      taskId: request.taskId,
      status: ResponseStatus.ACCEPTED,
      message: 'Feedback processing started and execution started',
      workerStatus: 'processing_feedback'
    };
  }

  private async handleRequestMerge(request: TaskRequest): Promise<TaskResponse> {
    // PR 병합 요청 처리
    let worker = await this.workerPoolManager.getWorkerByTaskId(request.taskId);
    
    // 이미 작업이 진행 중인 경우 중복 처리 방지 (working 상태만)
    if (worker) {
      const workerInstance = await this.workerPoolManager.getWorkerInstance(worker.id, this.pullRequestService);
      if (workerInstance && workerInstance.getStatus() === 'working') {
        this.logger?.info('Worker already processing merge request', {
          taskId: request.taskId,
          workerId: worker.id,
          status: workerInstance.getStatus()
        });
        
        return {
          taskId: request.taskId,
          status: ResponseStatus.ACCEPTED,
          message: 'Merge request already being processed',
          workerStatus: 'already_processing'
        };
      }
    }
    
    // 기존 worker가 없거나 idle 상태면 새로운 worker를 할당
    if (!worker) {
      worker = await this.workerPoolManager.getAvailableWorker();
      if (!worker) {
        return {
          taskId: request.taskId,
          status: ResponseStatus.ERROR,
          message: 'No available worker for merge request',
          workerStatus: 'no_available_worker'
        };
      }

      this.logger?.info('Assigned new worker for merge request', {
        taskId: request.taskId,
        workerId: worker.id
      });
    }

    // 병합 요청을 위한 작업 정보 생성
    const mergeTask = {
      taskId: request.taskId,
      action: 'merge_request' as any,
      pullRequestUrl: request.pullRequestUrl,
      boardItem: request.boardItem,
      repositoryId: this.extractRepositoryFromBoardItem?.(request.boardItem, request.pullRequestUrl) || 'test-owner/test-repo',
      assignedAt: new Date()
    };

    // Worker에 병합 작업 할당
    await this.workerPoolManager.assignWorkerTask(worker.id, mergeTask);

    // 작업 즉시 실행
    const workerInstance = await this.workerPoolManager.getWorkerInstance(worker.id, this.pullRequestService);
    if (workerInstance) {
      // 비동기로 작업 실행 (완료를 기다리지 않음)
      workerInstance.startExecution().then(async (result) => {
        this.logger?.info('Merge request execution completed', {
          taskId: request.taskId,
          workerId: worker.id,
          success: result.success
        });
        
        // 병합이 성공한 경우 작업을 Done 상태로 변경
        if (result.success && this.projectBoardService) {
          await this.updateTaskStatusToDone(request.taskId);
        }
        
        // 작업 완료 후 Worker 해제
        if (worker?.id) {
          Promise.resolve(this.workerPoolManager.releaseWorker(worker.id)).catch(err => {
            this.logger?.error('Failed to release worker after merge', {
              workerId: worker.id,
              error: err
            });
          });
        }
      }).catch((error) => {
        this.logger?.error('Merge request execution failed', {
          taskId: request.taskId,
          workerId: worker.id,
          error: error instanceof Error ? error.message : String(error)
        });
        
        // 병합 실패 시에는 Worker를 해제하지 않음 (재시도 가능하도록)
      });
    }

    this.logger?.info('Merge request task assigned and started', {
      taskId: request.taskId,
      workerId: worker.id,
      pullRequestUrl: request.pullRequestUrl
    });

    return {
      taskId: request.taskId,
      status: ResponseStatus.ACCEPTED,
      message: 'Merge request processing started',
      workerStatus: 'processing_merge'
    };
  }

  private async reassignTask(request: TaskRequest): Promise<TaskResponse> {
    this.logger?.warn('Worker not found for task, attempting to reassign', {
      taskId: request.taskId
    });

    // 작업 재할당 가능성 검증
    const canReassign = await this.taskAssignmentValidator.validateTaskReassignment(request.taskId, request.boardItem);
    if (!canReassign.allowed) {
      this.logger?.warn('Task cannot be reassigned', {
        taskId: request.taskId,
        reason: canReassign.reason
      });
    }

    // 사용 가능한 Worker 찾기 (idle 또는 waiting 상태)
    const availableWorker = await this.workerPoolManager.getAvailableWorker();
    if (!availableWorker) {
      return {
        taskId: request.taskId,
        status: ResponseStatus.ERROR,
        message: 'No available workers to reassign task',
        workerStatus: 'unavailable'
      };
    }

    // Worker 인스턴스 가져와서 상태 확인
    const workerInstance = await this.workerPoolManager.getWorkerInstance(availableWorker.id, this.pullRequestService);
    if (!workerInstance) {
      return {
        taskId: request.taskId,
        status: ResponseStatus.ERROR,
        message: 'Failed to get worker instance for reassignment',
        workerStatus: 'unavailable'
      };
    }

    const workerStatus = workerInstance.getStatus();
    
    this.logger?.debug('Worker status verification', {
      workerId: availableWorker.id,
      jsonStatus: availableWorker.status,
      instanceStatus: workerStatus,
      taskAction: WorkerAction.RESUME_TASK,
      isStatusSynced: availableWorker.status === workerStatus,
      hasWorkspace: canReassign.hasWorkspace
    });

    // workspace가 존재하지 않는 idle 상태인 Worker에는 resume_task 할당 불가
    if (workerStatus === 'idle' && !canReassign.hasWorkspace) {
      this.logger?.error('Failed to reassign task - no workspace found', {
        taskId: request.taskId,
        workerId: availableWorker.id,
        error: `Worker ${availableWorker.id} is idle and no workspace exists for task ${request.taskId}`
      });
      
      return {
        taskId: request.taskId,
        status: ResponseStatus.ERROR,
        message: 'Failed to reassign task - no workspace found',
        workerStatus: 'error'
      };
    }

    // workspace가 존재하는 경우 idle Worker에도 재할당 허용
    if (workerStatus === 'idle' && canReassign.hasWorkspace) {
      this.logger?.info('Allowing task reassignment to idle worker with existing workspace', {
        taskId: request.taskId,
        workerId: availableWorker.id,
        workspaceDir: canReassign.workspaceInfo?.workspaceDir
      });
    }

    // 작업 재할당 (RESUME_TASK 액션으로)
    const resumeTask = {
      taskId: request.taskId,
      action: WorkerAction.RESUME_TASK,
      boardItem: request.boardItem,
      repositoryId: request.boardItem?.metadata?.repository || 'test-owner/test-repo',
      assignedAt: new Date()
    };

    try {
      await this.workerPoolManager.assignWorkerTask(availableWorker.id, resumeTask);
      
      // 작업 실행은 비동기로 처리 (즉시 반환)
      this.workerTaskExecutor.assignAndExecuteTask(availableWorker.id, resumeTask, this.pullRequestService)
        .catch((error) => {
          this.logger?.error('Reassigned task execution failed', {
            taskId: request.taskId,
            workerId: availableWorker.id,
            error: error instanceof Error ? error.message : String(error)
          });
        });

      this.logger?.info('Task successfully reassigned to available worker', {
        taskId: request.taskId,
        workerId: availableWorker.id,
        workerStatus: workerStatus
      });

      return {
        taskId: request.taskId,
        status: ResponseStatus.IN_PROGRESS,
        message: 'Task reassigned and execution resumed',
        workerStatus: 'reassigned'
      };

    } catch (error) {
      this.logger?.error('Failed to reassign task', {
        taskId: request.taskId,
        workerId: availableWorker.id,
        error: error instanceof Error ? error.message : String(error)
      });
      
      return {
        taskId: request.taskId,
        status: ResponseStatus.ERROR,
        message: 'Failed to reassign task',
        workerStatus: 'error'
      };
    }
  }



  private async handleReleaseWorker(request: TaskRequest): Promise<TaskResponse> {
    this.logger?.info('Received worker release request', {
      taskId: request.taskId
    });

    try {
      // Worker 찾기
      const worker = await this.workerPoolManager.getWorkerByTaskId(request.taskId);
      
      if (worker) {
        // Worker 해제
        await this.workerPoolManager.releaseWorker(worker.id);
        
        this.logger?.info('Worker released successfully', {
          taskId: request.taskId,
          workerId: worker.id
        });
        
        return {
          taskId: request.taskId,
          status: ResponseStatus.ACCEPTED,
          message: 'Worker released successfully',
          workerStatus: 'released'
        };
      } else {
        this.logger?.warn('Worker not found for task, may already be released', {
          taskId: request.taskId
        });
        
        return {
          taskId: request.taskId,
          status: ResponseStatus.ACCEPTED,
          message: 'Worker already released or not found',
          workerStatus: 'not_found'
        };
      }
      
    } catch (error) {
      this.logger?.error('Failed to release worker', {
        taskId: request.taskId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      return {
        taskId: request.taskId,
        status: ResponseStatus.ERROR,
        message: 'Failed to release worker',
        workerStatus: 'error'
      };
    }
  }

  private async updateTaskStatusToDone(taskId: string): Promise<void> {
    if (this.projectBoardService) {
      await this.projectBoardService.updateItemStatus(taskId, 'DONE');
      this.logger?.info('Task status updated to DONE after merge completion', {
        taskId
      });
    } else {
      this.logger?.warn('ProjectBoardService not available, cannot update task status', {
        taskId
      });
    }
  }

}
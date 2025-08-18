import {
  WorkerInterface,
  WorkerTask,
  WorkerStatus,
  WorkerStage,
  WorkerProgress,
  WorkerResult,
  WorkerAction,
  WorkerDependencies
} from '@/types';

export class Worker implements WorkerInterface {
  private _status: WorkerStatus = WorkerStatus.IDLE;
  private _currentTask: WorkerTask | null = null;
  private _progress: WorkerProgress | null = null;
  private _lastActiveAt: Date = new Date();
  
  // 오류 관리 관련 필드
  private _errorCount: number = 0;
  private _lastErrorAt: Date | null = null;
  private _consecutiveErrors: number = 0;
  private readonly _maxRetries: number = 3;
  private readonly _maxConsecutiveErrors: number = 5;

  public readonly id: string;
  public readonly workspaceDir: string;
  public readonly developerType: 'claude' | 'gemini';
  public readonly createdAt: Date = new Date();

  constructor(
    id: string,
    workspaceDir: string,
    developerType: 'claude' | 'gemini',
    private readonly dependencies: WorkerDependencies,
    initialStatus: WorkerStatus = WorkerStatus.IDLE,
    initialTask: WorkerTask | null = null
  ) {
    this.id = id;
    this.workspaceDir = workspaceDir;
    this.developerType = developerType;
    this._status = initialStatus;
    this._currentTask = initialTask;
  }

  // Getter properties to match the Worker interface
  get status(): WorkerStatus {
    return this._status;
  }

  get currentTaskId(): string | undefined {
    return this._currentTask?.taskId;
  }

  get currentTask(): WorkerTask | null {
    return this._currentTask;
  }

  get lastActiveAt(): Date {
    return this._lastActiveAt;
  }

  get errorCount(): number {
    return this._errorCount;
  }

  get consecutiveErrors(): number {
    return this._consecutiveErrors;
  }

  get lastErrorAt(): Date | null {
    return this._lastErrorAt;
  }

  async assignTask(task: WorkerTask): Promise<void> {
    // 작업 액션에 따른 상태 검증
    const isNewTaskAction = task.action === WorkerAction.START_NEW_TASK;
    const isFeedbackAction = task.action === WorkerAction.PROCESS_FEEDBACK;
    const isResumeAction = task.action === WorkerAction.RESUME_TASK;
    const isMergeAction = task.action === WorkerAction.MERGE_REQUEST;
    
    if (isNewTaskAction && this._status !== WorkerStatus.IDLE) {
      throw new Error('Worker is already assigned to a task');
    }
    
    // RESUME_TASK는 idle 상태에서도 허용 (workspace 존재하는 경우)
    if (isResumeAction && 
        this._status !== WorkerStatus.WAITING && 
        this._status !== WorkerStatus.ERROR && 
        this._status !== WorkerStatus.IDLE) {
      throw new Error(`Worker cannot process ${task.action} in status: ${this._status}`);
    }
    
    // FEEDBACK 및 MERGE 작업은 기존 규칙 유지 (waiting 또는 error 상태에서만)
    if ((isFeedbackAction || isMergeAction) && 
        this._status !== WorkerStatus.WAITING && this._status !== WorkerStatus.ERROR) {
      throw new Error(`Worker cannot process ${task.action} in status: ${this._status}`);
    }
    
    if (this._status === WorkerStatus.WORKING) {
      throw new Error('Worker is currently working');
    }
    
    if (this._status === WorkerStatus.STOPPED) {
      throw new Error('Worker is stopped');
    }

    const previousStatus = this._status;
    
    // idle 상태에서 RESUME_TASK 할당에 대한 특별 로깅
    if (isResumeAction && previousStatus === WorkerStatus.IDLE) {
      this.dependencies.logger.info('Resuming task on idle worker (workspace should exist)', {
        workerId: this.id,
        taskId: task.taskId,
        previousStatus: previousStatus,
        action: task.action
      });
    }

    this._currentTask = task;
    this._status = WorkerStatus.WAITING;
    this._lastActiveAt = new Date();
    this._progress = {
      taskId: task.taskId,
      stage: WorkerStage.PREPARING_WORKSPACE,
      message: isResumeAction && previousStatus === WorkerStatus.IDLE ? 
        '기존 workspace에서 작업 재개 준비 중' : '작업 준비 중',
      timestamp: new Date()
    };

    this.dependencies.logger.info('Task assigned to worker', {
      workerId: this.id,
      taskId: task.taskId,
      action: task.action,
      previousStatus: previousStatus
    });
  }

  async startExecution(): Promise<WorkerResult> {
    if (!this._currentTask) {
      throw new Error('No task assigned to worker');
    }

    const task = this._currentTask;
    this._status = WorkerStatus.WORKING;
    this._lastActiveAt = new Date();

    try {
      this.dependencies.logger.info('Starting task execution', {
        workerId: this.id,
        taskId: task.taskId
      });

      // 0. Developer 초기화 확인 및 수행 (재시도 로직 포함)
      if (this.dependencies.developer && typeof this.dependencies.developer.initialize === 'function') {
        const maxRetries = 3;
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            await this.dependencies.developer.initialize();
            this.dependencies.logger.debug('Developer initialized successfully', {
              workerId: this.id,
              developerType: this.developerType,
              attempt
            });
            lastError = null;
            break;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            this.dependencies.logger.warn('Developer initialization failed', {
              workerId: this.id,
              developerType: this.developerType,
              attempt,
              maxRetries,
              error: lastError
            });
            
            // 마지막 시도가 아니면 잠시 대기 후 재시도
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
          }
        }
        
        // 모든 재시도가 실패한 경우
        if (lastError) {
          this.dependencies.logger.error('Developer initialization failed after all retries', {
            workerId: this.id,
            developerType: this.developerType,
            maxRetries,
            error: lastError
          });
          throw lastError;
        }
      }

      // 1. 워크스페이스 준비
      this.updateProgress(WorkerStage.PREPARING_WORKSPACE, '워크스페이스 준비 중');
      const workspaceInfo = await this.dependencies.workspaceSetup.prepareWorkspace(task);

      // 2. 프롬프트 생성
      this.updateProgress(WorkerStage.GENERATING_PROMPT, '프롬프트 생성 중');
      const prompt = await this.generatePrompt(task, workspaceInfo);

      // 3. 작업 실행
      this.updateProgress(WorkerStage.EXECUTING_TASK, '작업 실행 중');
      const developerOutput = await this.dependencies.developer.executePrompt(prompt, workspaceInfo.workspaceDir);

      // 4. 결과 처리
      this.updateProgress(WorkerStage.PROCESSING_RESULT, '결과 처리 중');
      const result = await this.dependencies.resultProcessor.processOutput(developerOutput.rawOutput, task);

      // 5. 작업 완료
      this.updateProgress(WorkerStage.COMPLETING_TASK, '작업 완료 중');
      
      // 병합 작업이 성공한 경우 워크스페이스 정리
      if (task.action === WorkerAction.MERGE_REQUEST && result.success) {
        this.dependencies.logger.info('Cleaning up workspace after successful merge', {
          workerId: this.id,
          taskId: task.taskId
        });
        
        try {
          await this.dependencies.workspaceSetup.cleanupWorkspace(task.taskId);
        } catch (cleanupError) {
          this.dependencies.logger.warn('Failed to cleanup workspace after merge', {
            workerId: this.id,
            taskId: task.taskId,
            error: cleanupError
          });
        }
      }
      
      // 작업 성공 시 연속 오류 카운트 리셋
      this.resetConsecutiveErrors();
      
      // 작업 수행은 완료되었지만 Worker는 여전히 할당된 상태로 유지
      // Planner가 전체 워크플로우 완료를 확인한 후에 Worker를 해제함
      this._status = WorkerStatus.WAITING; // 작업 완료 후 대기 상태로 변경
      this.updateProgress(WorkerStage.TASK_COMPLETED, '작업 수행 완료, 워크플로우 대기 중');

      this.dependencies.logger.info('Task execution completed successfully', {
        workerId: this.id,
        taskId: task.taskId,
        success: result.success,
        note: 'Worker remains assigned until workflow completion',
        errorCountReset: true
      });

      return result;

    } catch (error) {
      const currentStage = this._progress?.stage || WorkerStage.PREPARING_WORKSPACE;
      
      // 오류 카운트 증가
      this._errorCount++;
      this._consecutiveErrors++;
      this._lastErrorAt = new Date();
      
      this.dependencies.logger.error('Task execution failed', {
        workerId: this.id,
        taskId: task.taskId,
        action: task.action,
        stage: currentStage,
        error,
        errorCount: this._errorCount,
        consecutiveErrors: this._consecutiveErrors
      });

      // 연속 오류가 너무 많으면 Worker를 중지 상태로 변경
      if (this._consecutiveErrors >= this._maxConsecutiveErrors) {
        this._status = WorkerStatus.STOPPED;
        this.updateProgress(
          WorkerStage.PROCESSING_RESULT, 
          `연속 오류 한계 도달 (${this._maxConsecutiveErrors}회), Worker 중지됨`
        );
        
        this.dependencies.logger.error('Worker stopped due to consecutive errors', {
          workerId: this.id,
          taskId: task.taskId,
          consecutiveErrors: this._consecutiveErrors,
          maxAllowed: this._maxConsecutiveErrors
        });
        
        const errorMessage = `Worker stopped due to consecutive errors: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`;
        throw new Error(errorMessage);
      }

      // 재시도 가능한 경우 WAITING 상태로 유지 (idle이 아닌!)
      const shouldRetry = this.shouldRetryOnError(task.action, error);
      
      if (shouldRetry) {
        this._status = WorkerStatus.WAITING; // WAITING 상태로 유지하여 재시도 가능하게 함
        this._lastActiveAt = new Date();
        
        const nextRetryDelay = this.calculateBackoffDelay();
        this.updateProgress(
          WorkerStage.PROCESSING_RESULT, 
          `오류 발생, ${nextRetryDelay}초 후 재시도 예정 (${this._consecutiveErrors}/${this._maxConsecutiveErrors}): ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        
        this.dependencies.logger.warn('Worker marked as WAITING for retry', {
          workerId: this.id,
          taskId: task.taskId,
          action: task.action,
          consecutiveErrors: this._consecutiveErrors,
          nextRetryDelay,
          willRetry: true
        });
      } else {
        // 재시도 불가능한 경우에만 작업 완료 처리
        this.completeTask();
        
        this.dependencies.logger.error('Worker task completed with error (no retry)', {
          workerId: this.id,
          taskId: task.taskId,
          action: task.action,
          reason: 'Non-retryable error'
        });
      }

      const errorMessage = `Failed to execute task ${task.taskId}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      
      throw new Error(errorMessage);
    }
  }

  async pauseExecution(): Promise<void> {
    if (this._currentTask && this._status !== WorkerStatus.STOPPED) {
      this._status = WorkerStatus.STOPPED;
      this._lastActiveAt = new Date();

      this.dependencies.logger.info('Worker execution paused', {
        workerId: this.id,
        taskId: this._currentTask.taskId
      });
    }
  }

  async resumeExecution(): Promise<void> {
    if (this._currentTask && (this._status === WorkerStatus.STOPPED || this._status === WorkerStatus.ERROR)) {
      const previousStatus = this._status;
      this._status = WorkerStatus.WAITING;
      this._lastActiveAt = new Date();

      this.dependencies.logger.info('Worker execution resumed', {
        workerId: this.id,
        taskId: this._currentTask.taskId,
        previousStatus: previousStatus === WorkerStatus.STOPPED ? 'stopped' : 'error'
      });
    }
  }

  async cancelExecution(): Promise<void> {
    if (this._currentTask) {
      const taskId = this._currentTask.taskId;
      
      this.completeTask();

      this.dependencies.logger.info('Worker execution cancelled', {
        workerId: this.id,
        taskId
      });
    }
  }

  getStatus(): WorkerStatus {
    return this._status;
  }

  getProgress(): WorkerProgress | null {
    return this._progress;
  }

  getCurrentTask(): WorkerTask | null {
    return this._currentTask;
  }

  async cleanup(): Promise<void> {
    try {
      if (this._currentTask) {
        await this.dependencies.workspaceSetup.cleanupWorkspace(this._currentTask.taskId);
      }

      this.completeTask();

      this.dependencies.logger.info('Worker cleanup completed', {
        workerId: this.id
      });

    } catch (error) {
      // 정리 작업 실패는 심각한 에러가 아니므로 로그만 남기고 계속 진행
      this.dependencies.logger.error('Worker cleanup failed', {
        workerId: this.id,
        error
      });
    }
  }

  private async generatePrompt(task: WorkerTask, workspaceInfo: any): Promise<string> {
    switch (task.action) {
      case WorkerAction.START_NEW_TASK:
        return await this.dependencies.promptGenerator.generateNewTaskPrompt(task, workspaceInfo);
      
      case WorkerAction.RESUME_TASK:
        return await this.dependencies.promptGenerator.generateResumePrompt(task, workspaceInfo);
      
      case WorkerAction.PROCESS_FEEDBACK:
        return await this.dependencies.promptGenerator.generateFeedbackPrompt(task, task.comments || []);
      
      case WorkerAction.MERGE_REQUEST:
        return await this.dependencies.promptGenerator.generateMergePrompt(task);
      
      default:
        throw new Error(`Unsupported task action: ${task.action}`);
    }
  }

  private updateProgress(stage: WorkerStage, message: string): void {
    if (this._currentTask) {
      this._progress = {
        taskId: this._currentTask.taskId,
        stage,
        message,
        timestamp: new Date()
      };
      this._lastActiveAt = new Date();

      this.dependencies.logger.debug('Worker progress updated', {
        workerId: this.id,
        taskId: this._currentTask.taskId,
        stage,
        message
      });
    }
  }

  async reset(): Promise<void> {
    try {
      // 진행 중인 작업이 있으면 취소
      if (this._currentTask) {
        await this.cancelExecution();
      }

      // 상태 초기화
      this._currentTask = null;
      this._status = WorkerStatus.IDLE;
      this._progress = null;
      this._lastActiveAt = new Date();

      this.dependencies.logger.info('Worker reset completed', {
        workerId: this.id
      });
    } catch (error) {
      this.dependencies.logger.error('Worker reset failed', {
        workerId: this.id,
        error
      });
      throw error;
    }
  }

  private completeTask(): void {
    this._currentTask = null;
    this._status = WorkerStatus.IDLE;
    this._progress = null;
    this._lastActiveAt = new Date();
  }

  /**
   * 작업 성공 시 연속 오류 카운트 리셋
   */
  private resetConsecutiveErrors(): void {
    if (this._consecutiveErrors > 0) {
      this.dependencies.logger.info('Resetting consecutive error count after success', {
        workerId: this.id,
        previousConsecutiveErrors: this._consecutiveErrors
      });
      this._consecutiveErrors = 0;
    }
  }

  /**
   * 오류 유형과 액션에 따라 재시도 여부 결정
   */
  private shouldRetryOnError(action: WorkerAction, error: unknown): boolean {
    const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    
    // 재시도하지 않을 조건들
    const nonRetryablePatterns = [
      'permission denied',
      'file not found',
      'authentication failed',
      'invalid credentials',
      'syntax error',
      'compilation error'
    ];
    
    // 비재시도 가능한 패턴이 있으면 false
    if (nonRetryablePatterns.some(pattern => errorMessage.includes(pattern))) {
      return false;
    }
    
    // 재시도 가능한 조건들 (일시적 오류)
    const retryablePatterns = [
      'network error',
      'timeout',
      'connection refused',
      'rate limit',
      'service unavailable',
      'internal server error',
      'claude process exited with code 1' // Claude 실행 오류는 재시도 가능
    ];
    
    // 재시도 가능한 패턴이 있으면 true
    if (retryablePatterns.some(pattern => errorMessage.includes(pattern))) {
      return true;
    }
    
    // 액션별 기본 재시도 정책
    switch (action) {
      case WorkerAction.START_NEW_TASK:
      case WorkerAction.RESUME_TASK:
        return true; // 새 작업이나 재개는 기본적으로 재시도
      case WorkerAction.PROCESS_FEEDBACK:
        return true; // 피드백 처리도 재시도
      case WorkerAction.MERGE_REQUEST:
        return false; // 병합은 신중하게, 기본적으로 재시도 안함
      default:
        return false;
    }
  }

  /**
   * 백오프 지연 시간 계산 (지수 백오프)
   */
  private calculateBackoffDelay(): number {
    const baseDelay = 30; // 기본 30초
    const maxDelay = 300; // 최대 5분
    const delay = Math.min(baseDelay * Math.pow(2, this._consecutiveErrors - 1), maxDelay);
    return delay;
  }

  /**
   * 재시도 대기 시간이 경과했는지 확인
   */
  canRetryNow(): boolean {
    if (!this._lastErrorAt) return true;
    
    const delayMs = this.calculateBackoffDelay() * 1000;
    const elapsed = Date.now() - this._lastErrorAt.getTime();
    return elapsed >= delayMs;
  }
}
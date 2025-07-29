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

  public readonly id: string;
  public readonly workspaceDir: string;
  public readonly developerType: 'claude' | 'gemini';
  public readonly createdAt: Date = new Date();

  constructor(
    id: string,
    workspaceDir: string,
    developerType: 'claude' | 'gemini',
    private readonly dependencies: WorkerDependencies
  ) {
    this.id = id;
    this.workspaceDir = workspaceDir;
    this.developerType = developerType;
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

  async assignTask(task: WorkerTask): Promise<void> {
    if (this._status !== WorkerStatus.IDLE) {
      throw new Error('Worker is already assigned to a task');
    }

    this._currentTask = task;
    this._status = WorkerStatus.WAITING;
    this._lastActiveAt = new Date();
    this._progress = {
      taskId: task.taskId,
      stage: WorkerStage.PREPARING_WORKSPACE,
      message: '작업 준비 중',
      timestamp: new Date()
    };

    this.dependencies.logger.info('Task assigned to worker', {
      workerId: this.id,
      taskId: task.taskId,
      action: task.action
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

      // 1. 워크스페이스 준비
      this.updateProgress(WorkerStage.PREPARING_WORKSPACE, '워크스페이스 준비 중');
      const workspaceInfo = await this.dependencies.workspaceSetup.prepareWorkspace(task);

      // 2. 프롬프트 생성
      this.updateProgress(WorkerStage.GENERATING_PROMPT, '프롬프트 생성 중');
      const prompt = await this.generatePrompt(task, workspaceInfo);

      // 3. 작업 실행
      this.updateProgress(WorkerStage.EXECUTING_TASK, '작업 실행 중');
      const output = await this.dependencies.developer.executePrompt(prompt, workspaceInfo.workspaceDir);

      // 4. 결과 처리
      this.updateProgress(WorkerStage.PROCESSING_RESULT, '결과 처리 중');
      const result = await this.dependencies.resultProcessor.processOutput(output, task);

      // 5. 작업 완료
      this.updateProgress(WorkerStage.COMPLETING_TASK, '작업 완료 중');
      this.completeTask();

      this.dependencies.logger.info('Task execution completed successfully', {
        workerId: this.id,
        taskId: task.taskId,
        success: result.success
      });

      return result;

    } catch (error) {
      const currentStage = this._progress?.stage || WorkerStage.PREPARING_WORKSPACE;
      
      this.dependencies.logger.error('Task execution failed', {
        workerId: this.id,
        taskId: task.taskId,
        stage: currentStage,
        error
      });

      // 실패 시 상태 초기화
      this.completeTask();

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
    if (this._currentTask && this._status === WorkerStatus.STOPPED) {
      this._status = WorkerStatus.WAITING;
      this._lastActiveAt = new Date();

      this.dependencies.logger.info('Worker execution resumed', {
        workerId: this.id,
        taskId: this._currentTask.taskId
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

  private completeTask(): void {
    this._currentTask = null;
    this._status = WorkerStatus.IDLE;
    this._progress = null;
    this._lastActiveAt = new Date();
  }
}
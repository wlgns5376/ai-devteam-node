export enum WorkerStatus {
  IDLE = 'idle',
  WAITING = 'waiting',
  WORKING = 'working',
  STOPPED = 'stopped'
}

export enum WorkerAction {
  START_NEW_TASK = 'start_new_task',
  RESUME_TASK = 'resume_task', 
  PROCESS_FEEDBACK = 'process_feedback',
  MERGE_REQUEST = 'merge_request'
}

export enum WorkerStage {
  PREPARING_WORKSPACE = 'preparing_workspace',
  GENERATING_PROMPT = 'generating_prompt',
  EXECUTING_TASK = 'executing_task',
  PROCESSING_RESULT = 'processing_result',
  COMPLETING_TASK = 'completing_task'
}

export interface Worker {
  readonly id: string;
  readonly status: WorkerStatus;
  readonly currentTask?: WorkerTask;
  readonly workspaceDir: string;
  readonly developerType: 'claude' | 'gemini';
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  readonly workerType?: 'pool' | 'temporary'; // 풀 관리용 vs 임시 할당용
}

export interface WorkerPool {
  readonly workers: ReadonlyArray<Worker>;
  readonly minWorkers: number;
  readonly maxWorkers: number;
  readonly activeWorkers: number;
  readonly idleWorkers: number;
  readonly stoppedWorkers: number;
  readonly totalWorkers: number;
}

export interface WorkerUpdate {
  readonly status?: WorkerStatus;
  readonly currentTask?: WorkerTask | undefined;
  readonly lastActiveAt?: Date;
}

export interface WorkerTask {
  readonly taskId: string;
  readonly action: WorkerAction;
  readonly boardItem?: any; // ProjectBoardItem from planner types
  readonly comments?: ReadonlyArray<any>; // PullRequestComment from planner types
  readonly assignedAt: Date;
  readonly repositoryId: string;
  readonly pullRequestUrl?: string; // For merge request actions
}

export interface WorkerProgress {
  readonly taskId: string;
  readonly stage: WorkerStage;
  readonly message: string;
  readonly timestamp: Date;
  readonly details?: Record<string, unknown>;
}

export interface WorkerResult {
  readonly taskId: string;
  readonly success: boolean;
  readonly pullRequestUrl?: string;
  readonly errorMessage?: string;
  readonly completedAt: Date;
  readonly details?: Record<string, unknown>;
}

export interface WorkerError {
  readonly code: string;
  readonly message: string;
  readonly timestamp: Date;
  readonly context?: Record<string, unknown>;
}

// 인터페이스 분리 (ISP 적용)
export interface WorkerInterface {
  // 기본 생명주기
  assignTask(task: WorkerTask): Promise<void>;
  startExecution(): Promise<WorkerResult>;
  pauseExecution(): Promise<void>;
  resumeExecution(): Promise<void>;
  cancelExecution(): Promise<void>;
  
  // 상태 관리
  getStatus(): WorkerStatus;
  getProgress(): WorkerProgress | null;
  getCurrentTask(): WorkerTask | null;
  
  // 복구 및 정리
  reset(): Promise<void>;
  cleanup(): Promise<void>;
}

export interface WorkspaceSetupInterface {
  prepareWorkspace(task: WorkerTask): Promise<any>; // WorkspaceInfo
  validateEnvironment(workspaceInfo: any): Promise<boolean>;
  cleanupWorkspace(taskId: string): Promise<void>;
}

export interface PromptGeneratorInterface {
  generateNewTaskPrompt(task: WorkerTask, workspaceInfo: any): Promise<string>;
  generateResumePrompt(task: WorkerTask, workspaceInfo: any): Promise<string>;
  generateFeedbackPrompt(task: WorkerTask, comments: ReadonlyArray<any>): Promise<string>;
  generateMergePrompt(task: WorkerTask): Promise<string>;
}

export interface ResultProcessorInterface {
  processOutput(output: string, task: WorkerTask): Promise<WorkerResult>;
  extractPullRequestUrl(output: string): string | null;
  extractErrorInfo(output: string): WorkerError | null;
  generateStatusReport(task: WorkerTask, result: WorkerResult): Promise<any>; // TaskResponse
}

// DeveloperInterface는 developer.types.ts에 정의됨

export interface WorkerDependencies {
  readonly logger: any;
  readonly workspaceSetup: WorkspaceSetupInterface;
  readonly promptGenerator: PromptGeneratorInterface;
  readonly resultProcessor: ResultProcessorInterface;
  readonly developer: any; // DeveloperInterface from developer.types.ts
}
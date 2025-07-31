import { ProjectBoardItem } from './project-board.types';
import { PullRequestComment, CommentFilterOptions } from './pull-request.types';
import { RepositoryFilterConfig } from './config.types';

export interface PlannerServiceConfig {
  readonly boardId: string;
  readonly repoId: string;
  readonly monitoringIntervalMs: number;
  readonly maxRetryAttempts: number;
  readonly timeoutMs: number;
  readonly repositoryFilter?: RepositoryFilterConfig;
  readonly pullRequestFilter?: CommentFilterOptions;
}

export interface PlannerStatus {
  readonly isRunning: boolean;
  readonly lastSyncTime?: Date | undefined;
  readonly totalTasksProcessed: number;
  readonly activeTasks: number;
  readonly errors: PlannerError[];
}

export interface PlannerError {
  readonly message: string;
  readonly code: string;
  readonly timestamp: Date;
  readonly context?: Record<string, unknown> | undefined;
}

export enum TaskAction {
  START_NEW_TASK = 'start_new_task',
  CHECK_STATUS = 'check_status', 
  PROCESS_FEEDBACK = 'process_feedback',
  REQUEST_MERGE = 'request_merge',
  RESUME_TASK = 'resume_task'
}

export enum ResponseStatus {
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
  IN_PROGRESS = 'in_progress',
  WAITING = 'waiting',
  ERROR = 'error'
}

export interface TaskRequest {
  readonly taskId: string;
  readonly action: TaskAction;
  readonly boardItem?: ProjectBoardItem | undefined;
  readonly pullRequestUrl?: string | undefined;
  readonly comments?: ReadonlyArray<PullRequestComment> | undefined;
}

export interface TaskResponse {
  readonly taskId: string;
  readonly status: ResponseStatus;
  readonly message?: string | undefined;
  readonly pullRequestUrl?: string | undefined;
  readonly workerStatus?: string | undefined;
}

export interface ManagerCommunicator {
  sendTaskToManager(request: TaskRequest): Promise<TaskResponse>;
}

export interface WorkflowState {
  lastSyncTime?: Date | undefined;
  processedTasks: Set<string>;
  processedComments: Set<string>;
  activeTasks: Map<string, TaskInfo>;
}

export interface TaskInfo {
  readonly taskId: string;
  readonly status: string;
  readonly startedAt: Date;
  readonly lastUpdatedAt: Date;
}

export interface PlannerDependencies {
  readonly projectBoardService: any;
  readonly pullRequestService: any;
  readonly stateManager: any;
  readonly logger: any;
  readonly managerCommunicator: ManagerCommunicator;
}

export interface PlannerService {
  startMonitoring(): Promise<void>;
  stopMonitoring(): Promise<void>;
  isRunning(): boolean;
  getStatus(): PlannerStatus;
  forceSync(): Promise<void>;
  processWorkflowCycle(): Promise<void>;
  handleNewTasks(): Promise<void>;
  handleInProgressTasks(): Promise<void>;
  handleReviewTasks(): Promise<void>;
}
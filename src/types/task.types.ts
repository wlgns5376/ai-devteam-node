export enum TaskStatus {
  TODO = 'todo',
  IN_PROGRESS = 'in-progress',
  IN_REVIEW = 'in-review',
  DONE = 'done'
}

export enum TaskPriority {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low'
}

export interface Task {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly assignedWorker?: string;
  readonly projectId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly prUrl?: string;
  readonly comments?: ReadonlyArray<string>;
  readonly processedCommentIds?: ReadonlyArray<string>;
  readonly retryCount?: number;
  readonly lastRetryAt?: Date;
  readonly failureReasons?: ReadonlyArray<string>;
  readonly lastSyncTime?: Date; // 이 작업에 대한 마지막 동기화 시간 (PR 코멘트 확인 시점)
}

export interface TaskUpdate {
  readonly status?: TaskStatus;
  readonly assignedWorker?: string;
  readonly prUrl?: string;
  readonly comments?: ReadonlyArray<string>;
  readonly processedCommentIds?: ReadonlyArray<string>;
}
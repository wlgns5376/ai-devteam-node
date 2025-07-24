export enum WorkerStatus {
  IDLE = 'idle',
  WAITING = 'waiting',
  WORKING = 'working',
  STOPPED = 'stopped'
}

export interface Worker {
  readonly id: string;
  readonly status: WorkerStatus;
  readonly currentTaskId?: string;
  readonly workspaceDir: string;
  readonly developerType: 'claude' | 'gemini';
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
}

export interface WorkerPool {
  readonly workers: ReadonlyArray<Worker>;
  readonly minWorkers: number;
  readonly maxWorkers: number;
  readonly activeWorkers: number;
}

export interface WorkerUpdate {
  readonly status?: WorkerStatus;
  readonly currentTaskId?: string | undefined;
  readonly lastActiveAt?: Date;
}
import { Worker, WorkerPool, WorkerStatus } from './worker.types';
import { TaskRequest, TaskResponse } from './planner.types';

export interface ManagerServiceConfig {
  readonly workspaceBasePath: string;
  readonly minWorkers: number;
  readonly maxWorkers: number;
  readonly workerRecoveryTimeoutMs: number;
  readonly gitOperationTimeoutMs: number;
  readonly repositoryCacheTimeoutMs: number;
  readonly workerLifecycle?: {
    readonly idleTimeoutMinutes: number;
    readonly cleanupIntervalMinutes: number;
    readonly minPersistentWorkers: number;
  };
}

export interface ManagerStatus {
  readonly isRunning: boolean;
  readonly workerPool: WorkerPool;
  readonly activeRepositories: ReadonlyArray<string>;
  readonly errors: ManagerError[];
  readonly lastActivityAt?: Date;
}

export interface ManagerError {
  readonly message: string;
  readonly code: string;
  readonly timestamp: Date;
  readonly context?: Record<string, unknown>;
}

export interface WorkspaceInfo {
  readonly taskId: string;
  readonly repositoryId: string;
  readonly workspaceDir: string;
  readonly branchName: string;
  readonly worktreeCreated: boolean;
  readonly claudeLocalPath: string;
  readonly createdAt: Date;
}

export interface RepositoryState {
  readonly id: string;
  readonly localPath: string;
  readonly lastFetchAt: Date;
  readonly isCloned: boolean;
  readonly activeWorktrees: ReadonlyArray<string>;
}

// 인터페이스 분리 원칙 적용
export interface WorkerPoolManagerInterface {
  initializePool(): Promise<void>;
  getAvailableWorker(): Promise<Worker | null>;
  assignWorker(workerId: string, taskId: string): Promise<void>;
  releaseWorker(workerId: string): Promise<void>;
  updateWorkerStatus(workerId: string, status: WorkerStatus): Promise<void>;
  recoverStoppedWorkers(): Promise<void>;
  recoverErrorWorkers(): Promise<void>;
  getPoolStatus(): WorkerPool;
  shutdown(): Promise<void>;
}

export interface WorkspaceManagerInterface {
  createWorkspace(taskId: string, repositoryId: string, boardItem?: any): Promise<WorkspaceInfo>;
  setupWorktree(workspaceInfo: WorkspaceInfo, baseBranch?: string): Promise<void>;
  setupClaudeLocal(workspaceInfo: WorkspaceInfo): Promise<void>;
  cleanupWorkspace(taskId: string): Promise<void>;
  getWorkspaceInfo(taskId: string): Promise<WorkspaceInfo | null>;
  isWorktreeValid(workspaceInfo: WorkspaceInfo): Promise<boolean>;
}

export interface RepositoryManagerInterface {
  ensureRepository(repositoryId: string, forceUpdate?: boolean): Promise<string>;
  cloneRepository(repositoryId: string): Promise<string>;
  fetchRepository(repositoryId: string): Promise<void>;
  getRepositoryState(repositoryId: string): Promise<RepositoryState | null>;
  isRepositoryCloned(repositoryId: string): Promise<boolean>;
  addWorktree(repositoryId: string, worktreePath: string): Promise<void>;
  removeWorktree(repositoryId: string, worktreePath: string): Promise<void>;
}

export interface TaskRouterInterface {
  routeTaskToWorker(request: TaskRequest): Promise<TaskResponse>;
  checkTaskStatus(taskId: string): Promise<TaskResponse>;
  handleTaskCompletion(taskId: string, pullRequestUrl: string): Promise<void>;
}

export interface GitOperationLock {
  readonly repositoryId: string;
  readonly operation: 'clone' | 'fetch' | 'pull' | 'worktree';
  readonly acquiredAt: Date;
}

export interface ManagerDependencies {
  readonly logger: any;
  readonly stateManager: any;
  readonly repositoryService: any;
  readonly gitService: GitServiceInterface;
}

export interface GitServiceInterface {
  clone(repositoryUrl: string, localPath: string): Promise<void>;
  fetch(localPath: string): Promise<void>;
  pullMainBranch(localPath: string): Promise<void>;
  createWorktree(repoPath: string, branchName: string, worktreePath: string, baseBranch?: string): Promise<void>;
  removeWorktree(repoPath: string, worktreePath: string): Promise<void>;
  isValidRepository(path: string): Promise<boolean>;
}

export interface ManagerService {
  start(): Promise<void>;
  stop(): Promise<void>;
  handleTaskRequest(request: TaskRequest): Promise<TaskResponse>;
  getStatus(): ManagerStatus;
  recoverSystem(): Promise<void>;
}

// Manager 생성자에 필요한 의존성 타입
export interface ManagerConstructorDependencies extends ManagerDependencies {
  readonly workerPoolManager: WorkerPoolManagerInterface;
  readonly workspaceManager: WorkspaceManagerInterface;
  readonly repositoryManager: RepositoryManagerInterface;
  readonly taskRouter: TaskRouterInterface;
}
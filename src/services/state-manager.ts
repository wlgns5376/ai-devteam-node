import fs from 'fs/promises';
import path from 'path';
import { Task, TaskStatus, Worker, WorkerStatus, WorkspaceInfo } from '@/types';
import { RepositoryState } from '@/types/manager.types';

export interface PlannerState {
  lastSyncTime?: Date;
  processedComments: string[];
}

export class StateManager {
  private readonly dataDir: string;
  private readonly tasksFile: string;
  private readonly workersFile: string;
  private readonly workspacesFile: string;
  private readonly repositoriesFile: string;
  private readonly plannerStateFile: string;
  private readonly lockFile: string;

  private tasks: Map<string, Task> = new Map();
  private workers: Map<string, Worker> = new Map();
  private workspaces: Map<string, WorkspaceInfo> = new Map();
  private repositories: Map<string, RepositoryState> = new Map();
  private plannerState: PlannerState = { processedComments: [] };

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.tasksFile = path.join(dataDir, 'tasks.json');
    this.workersFile = path.join(dataDir, 'workers.json');
    this.workspacesFile = path.join(dataDir, 'workspaces.json');
    this.repositoriesFile = path.join(dataDir, 'repositories.json');
    this.plannerStateFile = path.join(dataDir, 'planner-state.json');
    this.lockFile = path.join(dataDir, '.lock');
  }

  async initialize(): Promise<void> {
    try {
      // 데이터 디렉토리 생성
      await fs.mkdir(this.dataDir, { recursive: true });

      // 기존 상태 파일 로드 또는 새로 생성
      await this.loadTasks();
      await this.loadWorkers();
      await this.loadWorkspaces();
      await this.loadRepositories();
      await this.loadPlannerState();
    } catch (error) {
      throw new Error(`Failed to initialize StateManager: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Task 관리 메서드들
  async saveTask(task: Task): Promise<void> {
    await this.withLock(async () => {
      this.tasks.set(task.id, { ...task });
      await this.persistTasks();
    });
  }

  async getTask(taskId: string): Promise<Task | undefined> {
    return this.tasks.get(taskId);
  }

  async getAllTasks(): Promise<Task[]> {
    return Array.from(this.tasks.values());
  }

  async getTasksByStatus(status: TaskStatus): Promise<Task[]> {
    return Array.from(this.tasks.values()).filter(task => task.status === status);
  }

  async removeTask(taskId: string): Promise<void> {
    await this.withLock(async () => {
      this.tasks.delete(taskId);
      await this.persistTasks();
    });
  }

  async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    await this.withLock(async () => {
      const task = this.tasks.get(taskId);
      if (task) {
        const updatedTask: Task = {
          ...task,
          status,
          updatedAt: new Date()
        };
        this.tasks.set(taskId, updatedTask);
        await this.persistTasks();
      }
    });
  }

  // Worker 관리 메서드들
  async saveWorker(worker: Worker): Promise<void> {
    await this.withLock(async () => {
      this.workers.set(worker.id, { ...worker });
      await this.persistWorkers();
    });
  }

  async getWorker(workerId: string): Promise<Worker | undefined> {
    return this.workers.get(workerId);
  }

  async getAllWorkers(): Promise<Worker[]> {
    return Array.from(this.workers.values());
  }

  async getWorkersByStatus(status: WorkerStatus): Promise<Worker[]> {
    return Array.from(this.workers.values()).filter(worker => worker.status === status);
  }

  async removeWorker(workerId: string): Promise<void> {
    await this.withLock(async () => {
      this.workers.delete(workerId);
      await this.persistWorkers();
    });
  }

  async updateWorkerStatus(workerId: string, status: WorkerStatus, currentTaskId?: string | undefined): Promise<void> {
    await this.withLock(async () => {
      const worker = this.workers.get(workerId);
      if (worker) {
        const updatedWorker: Worker = {
          ...worker,
          status,
          lastActiveAt: new Date(),
          ...(currentTaskId !== undefined && { currentTaskId })
        };
        this.workers.set(workerId, updatedWorker);
        await this.persistWorkers();
      }
    });
  }

  // Workspace 관리 메서드들
  async saveWorkspaceInfo(workspaceInfo: WorkspaceInfo): Promise<void> {
    await this.withLock(async () => {
      this.workspaces.set(workspaceInfo.taskId, { ...workspaceInfo });
      await this.persistWorkspaces();
    });
  }

  async loadWorkspaceInfo(taskId: string): Promise<WorkspaceInfo | null> {
    return this.workspaces.get(taskId) || null;
  }

  async removeWorkspaceInfo(taskId: string): Promise<void> {
    await this.withLock(async () => {
      this.workspaces.delete(taskId);
      await this.persistWorkspaces();
    });
  }

  async getAllWorkspaces(): Promise<WorkspaceInfo[]> {
    return Array.from(this.workspaces.values());
  }

  // Repository 관리 메서드들
  async saveRepositoryState(repositoryState: RepositoryState): Promise<void> {
    await this.withLock(async () => {
      this.repositories.set(repositoryState.id, { ...repositoryState });
      await this.persistRepositories();
    });
  }

  async loadRepositoryState(repositoryId: string): Promise<RepositoryState | null> {
    return this.repositories.get(repositoryId) || null;
  }

  async removeRepositoryState(repositoryId: string): Promise<void> {
    await this.withLock(async () => {
      this.repositories.delete(repositoryId);
      await this.persistRepositories();
    });
  }

  async getAllRepositories(): Promise<RepositoryState[]> {
    return Array.from(this.repositories.values());
  }

  // 플래너 상태 관리 메서드들
  async savePlannerState(state: Partial<PlannerState>): Promise<void> {
    await this.withLock(async () => {
      this.plannerState = { ...this.plannerState, ...state };
      await this.persistPlannerState();
    });
  }

  async getPlannerState(): Promise<PlannerState> {
    return { ...this.plannerState };
  }

  async updateLastSyncTime(time: Date): Promise<void> {
    await this.savePlannerState({ lastSyncTime: time });
  }

  async addProcessedComment(commentId: string): Promise<void> {
    await this.withLock(async () => {
      if (!this.plannerState.processedComments.includes(commentId)) {
        this.plannerState.processedComments.push(commentId);
        await this.persistPlannerState();
      }
    });
  }

  async isCommentProcessed(commentId: string): Promise<boolean> {
    return this.plannerState.processedComments.includes(commentId);
  }

  // 프라이빗 메서드들
  private async loadTasks(): Promise<void> {
    try {
      const tasksContent = await fs.readFile(this.tasksFile, 'utf-8');
      const tasksArray: Task[] = JSON.parse(tasksContent, this.dateReviver);
      
      this.tasks.clear();
      for (const task of tasksArray) {
        this.tasks.set(task.id, task);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // 파일이 없으면 빈 배열로 초기화
        this.tasks.clear();
        await this.persistTasks();
      } else {
        throw new Error(`Failed to load tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  private async loadWorkers(): Promise<void> {
    try {
      const workersContent = await fs.readFile(this.workersFile, 'utf-8');
      const workersArray: Worker[] = JSON.parse(workersContent, this.dateReviver);
      
      this.workers.clear();
      for (const worker of workersArray) {
        this.workers.set(worker.id, worker);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // 파일이 없으면 빈 배열로 초기화
        this.workers.clear();
        await this.persistWorkers();
      } else {
        throw new Error(`Failed to load workers: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  private async loadWorkspaces(): Promise<void> {
    try {
      const workspacesContent = await fs.readFile(this.workspacesFile, 'utf-8');
      const workspacesArray: WorkspaceInfo[] = JSON.parse(workspacesContent, this.dateReviver);
      
      this.workspaces.clear();
      for (const workspace of workspacesArray) {
        this.workspaces.set(workspace.taskId, workspace);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // 파일이 없으면 빈 배열로 초기화
        this.workspaces.clear();
        await this.persistWorkspaces();
      } else {
        throw new Error(`Failed to load workspaces: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  private async persistTasks(): Promise<void> {
    const tasksArray = Array.from(this.tasks.values());
    const tasksContent = JSON.stringify(tasksArray, null, 2);
    await fs.writeFile(this.tasksFile, tasksContent, 'utf-8');
  }

  private async persistWorkers(): Promise<void> {
    const workersArray = Array.from(this.workers.values());
    const workersContent = JSON.stringify(workersArray, null, 2);
    await fs.writeFile(this.workersFile, workersContent, 'utf-8');
  }

  private async persistWorkspaces(): Promise<void> {
    const workspacesArray = Array.from(this.workspaces.values());
    const workspacesContent = JSON.stringify(workspacesArray, null, 2);
    await fs.writeFile(this.workspacesFile, workspacesContent, 'utf-8');
  }

  private async loadRepositories(): Promise<void> {
    try {
      const repositoriesContent = await fs.readFile(this.repositoriesFile, 'utf-8');
      const repositoriesArray: RepositoryState[] = JSON.parse(repositoriesContent, this.dateReviver);
      
      this.repositories.clear();
      for (const repository of repositoriesArray) {
        this.repositories.set(repository.id, repository);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // 파일이 없으면 빈 배열로 초기화
        this.repositories.clear();
        await this.persistRepositories();
      } else {
        throw new Error(`Failed to load repositories: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  private async persistRepositories(): Promise<void> {
    const repositoriesArray = Array.from(this.repositories.values());
    const repositoriesContent = JSON.stringify(repositoriesArray, null, 2);
    await fs.writeFile(this.repositoriesFile, repositoriesContent, 'utf-8');
  }

  private async loadPlannerState(): Promise<void> {
    try {
      const plannerStateContent = await fs.readFile(this.plannerStateFile, 'utf-8');
      this.plannerState = JSON.parse(plannerStateContent, this.dateReviver);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // 파일이 없으면 기본값으로 초기화
        this.plannerState = { processedComments: [] };
        await this.persistPlannerState();
      } else {
        throw new Error(`Failed to load planner state: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  private async persistPlannerState(): Promise<void> {
    const plannerStateContent = JSON.stringify(this.plannerState, null, 2);
    await fs.writeFile(this.plannerStateFile, plannerStateContent, 'utf-8');
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    // 간단한 파일 기반 락 구현
    const maxRetries = 50;
    const retryDelay = 10; // ms

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // 락 파일 생성 시도
        await fs.writeFile(this.lockFile, process.pid.toString(), { flag: 'wx' });
        
        try {
          return await operation();
        } finally {
          // 락 해제
          await fs.unlink(this.lockFile);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          // 락이 이미 존재하면 잠시 대기 후 재시도
          await this.sleep(retryDelay);
          continue;
        }
        throw error;
      }
    }

    throw new Error('Failed to acquire lock after maximum retries');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private dateReviver(key: string, value: unknown): unknown {
    if (typeof value === 'string' && (key.endsWith('At') || key.endsWith('Date'))) {
      return new Date(value);
    }
    return value;
  }
}
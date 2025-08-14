import fs from 'fs/promises';
import path from 'path';
import { Task, TaskStatus, Worker, WorkerStatus, WorkspaceInfo } from '@/types';
import { RepositoryState } from '@/types/manager.types';

export class StateManager {
  private readonly dataDir: string;
  private readonly tasksFile: string;
  private readonly workersFile: string;
  private readonly workspacesFile: string;
  private readonly repositoriesFile: string;
  private readonly lockFile: string;

  private tasks: Map<string, Task> = new Map();
  private workers: Map<string, Worker> = new Map();
  private workspaces: Map<string, WorkspaceInfo> = new Map();
  private repositories: Map<string, RepositoryState> = new Map();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.tasksFile = path.join(dataDir, 'tasks.json');
    this.workersFile = path.join(dataDir, 'workers.json');
    this.workspacesFile = path.join(dataDir, 'workspaces.json');
    this.repositoriesFile = path.join(dataDir, 'repositories.json');
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

  // Worker 생명주기 관리 메서드들
  async getActiveWorkers(): Promise<Worker[]> {
    return Array.from(this.workers.values()).filter(worker => 
      worker.status === 'waiting' || worker.status === 'working'
    );
  }

  async cleanupIdleWorkers(idleTimeoutMinutes: number = 30): Promise<string[]> {
    const cleanedWorkerIds: string[] = [];
    const cutoffTime = new Date(Date.now() - idleTimeoutMinutes * 60 * 1000);
    
    await this.withLock(async () => {
      for (const [workerId, worker] of this.workers.entries()) {
        if (worker.status === 'idle' && worker.lastActiveAt && worker.lastActiveAt < cutoffTime) {
          this.workers.delete(workerId);
          cleanedWorkerIds.push(workerId);
        }
      }
      
      if (cleanedWorkerIds.length > 0) {
        await this.persistWorkers();
      }
    });
    
    return cleanedWorkerIds;
  }

  async removeCompletedWorkers(taskIds: string[]): Promise<string[]> {
    const removedWorkerIds: string[] = [];
    
    await this.withLock(async () => {
      for (const [workerId, worker] of this.workers.entries()) {
        if (worker.currentTask && taskIds.includes(worker.currentTask.taskId)) {
          this.workers.delete(workerId);
          removedWorkerIds.push(workerId);
        }
      }
      
      if (removedWorkerIds.length > 0) {
        await this.persistWorkers();
      }
    });
    
    return removedWorkerIds;
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

  // Worker Task lastSyncTime 관리 메서드들
  async getWorkerByTaskId(taskId: string): Promise<Worker | null> {
    for (const worker of this.workers.values()) {
      if (worker.currentTask?.taskId === taskId) {
        return worker;
      }
    }
    return null;
  }

  async getTaskLastSyncTime(taskId: string): Promise<Date | null> {
    const worker = await this.getWorkerByTaskId(taskId);
    return worker?.currentTask?.lastSyncTime || null;
  }

  async updateTaskLastSyncTime(taskId: string, lastSyncTime: Date): Promise<void> {
    await this.withLock(async () => {
      for (const [workerId, worker] of this.workers.entries()) {
        if (worker.currentTask?.taskId === taskId) {
          const updatedWorker: Worker = {
            ...worker,
            currentTask: {
              ...worker.currentTask,
              lastSyncTime
            },
            lastActiveAt: new Date()
          };
          this.workers.set(workerId, updatedWorker);
          await this.persistWorkers();
          break;
        }
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


  // 레거시 메서드 - 이제 작업별 lastSyncTime은 Worker에서 관리됨
  async updateLastSyncTime(_time: Date): Promise<void> {
    // 호환성을 위해 빈 구현으로 유지
  }


  // Task별 코멘트 관리 메서드들
  async addProcessedCommentToTask(taskId: string, commentId: string): Promise<void> {
    await this.withLock(async () => {
      const task = this.tasks.get(taskId);
      if (task) {
        const processedCommentIds = task.processedCommentIds ? [...task.processedCommentIds] : [];
        if (!processedCommentIds.includes(commentId)) {
          processedCommentIds.push(commentId);
          const updatedTask: Task = {
            ...task,
            processedCommentIds,
            updatedAt: new Date()
          };
          this.tasks.set(taskId, updatedTask);
          await this.persistTasks();
        }
      }
    });
  }

  async addProcessedCommentsToTask(taskId: string, commentIds: string[]): Promise<void> {
    await this.withLock(async () => {
      const task = this.tasks.get(taskId);
      if (task) {
        const processedCommentIds = task.processedCommentIds ? [...task.processedCommentIds] : [];
        let hasChanges = false;
        
        for (const commentId of commentIds) {
          if (!processedCommentIds.includes(commentId)) {
            processedCommentIds.push(commentId);
            hasChanges = true;
          }
        }
        
        if (hasChanges) {
          const updatedTask: Task = {
            ...task,
            processedCommentIds,
            updatedAt: new Date()
          };
          this.tasks.set(taskId, updatedTask);
          await this.persistTasks();
        }
      }
    });
  }

  async isCommentProcessedForTask(taskId: string, commentId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || !task.processedCommentIds) {
      return false;
    }
    return task.processedCommentIds.includes(commentId);
  }

  async getProcessedCommentsForTask(taskId: string): Promise<ReadonlyArray<string>> {
    const task = this.tasks.get(taskId);
    return task?.processedCommentIds || [];
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
      
      // 빈 파일이나 잘못된 JSON 처리
      if (!workersContent.trim()) {
        this.workers.clear();
        await this.persistWorkers();
        return;
      }
      
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
      } else if (error instanceof SyntaxError) {
        // JSON 파싱 오류 시 빈 상태로 초기화
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
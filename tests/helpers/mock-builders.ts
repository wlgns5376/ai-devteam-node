/**
 * Mock Builder 패턴
 * 복잡한 모킹 객체를 단계적으로 구성
 */

import { Worker, WorkerStatus, WorkerTask } from '@/types/worker.types';
import { ProjectBoardItem } from '@/types/project-board.types';
import { Logger } from '@/services/logger';
import { WorkerPoolManager } from '@/services/manager/worker-pool-manager';
import { Planner } from '@/services/planner';

/**
 * Worker Mock Builder
 */
export class MockWorkerBuilder {
  private workerData: {
    id: string;
    status: WorkerStatus;
    workspaceDir: string;
    developerType: 'claude' | 'gemini';
    createdAt: Date;
    lastActiveAt: Date;
    currentTask?: WorkerTask;
  };
  private mockMethods: Map<string, jest.Mock> = new Map();

  constructor() {
    // 기본값 설정
    this.workerData = {
      id: 'worker-test',
      status: WorkerStatus.IDLE,
      workspaceDir: '/tmp/test-worker',
      developerType: 'claude',
      createdAt: new Date(),
      lastActiveAt: new Date()
    };
  }

  withId(id: string): this {
    this.workerData.id = id;
    return this;
  }

  withStatus(status: WorkerStatus): this {
    this.workerData.status = status;
    return this;
  }

  withTask(task: WorkerTask | undefined): this {
    if (task) {
      this.workerData.currentTask = task;
    } else {
      delete this.workerData.currentTask;
    }
    return this;
  }

  withWorkspace(dir: string): this {
    this.workerData.workspaceDir = dir;
    return this;
  }

  withDeveloperType(type: 'claude' | 'gemini'): this {
    this.workerData.developerType = type;
    return this;
  }

  withMethod(methodName: string, implementation?: (...args: any[]) => any): this {
    this.mockMethods.set(methodName, jest.fn(implementation));
    return this;
  }

  build(): Worker & Record<string, jest.Mock> {
    const mockedWorker = { ...this.workerData } as Worker;
    
    // 모든 mock 메소드 추가
    this.mockMethods.forEach((mock, name) => {
      (mockedWorker as any)[name] = mock;
    });
    
    return mockedWorker as Worker & Record<string, jest.Mock>;
  }
}

/**
 * Logger Mock Builder
 */
export class MockLoggerBuilder {
  private methods: Map<string, jest.Mock> = new Map();

  constructor() {
    // 기본 Logger 메소드들
    ['info', 'warn', 'error', 'debug'].forEach(method => {
      this.methods.set(method, jest.fn());
    });
  }

  withInfo(implementation?: (...args: any[]) => void): this {
    this.methods.set('info', jest.fn(implementation));
    return this;
  }

  withError(implementation?: (...args: any[]) => void): this {
    this.methods.set('error', jest.fn(implementation));
    return this;
  }

  withWarn(implementation?: (...args: any[]) => void): this {
    this.methods.set('warn', jest.fn(implementation));
    return this;
  }

  withDebug(implementation?: (...args: any[]) => void): this {
    this.methods.set('debug', jest.fn(implementation));
    return this;
  }

  build(): jest.Mocked<Logger> {
    const logger: any = {};
    this.methods.forEach((mock, name) => {
      logger[name] = mock;
    });
    return logger as jest.Mocked<Logger>;
  }
}

/**
 * WorkerPoolManager Mock Builder
 */
export class MockWorkerPoolManagerBuilder {
  private methods: Map<string, jest.Mock> = new Map();
  private workers: Map<string, Worker> = new Map();

  constructor() {
    // 기본 메소드 설정
    this.methods.set('getWorkerByTaskId', jest.fn());
    this.methods.set('getAvailableWorker', jest.fn());
    this.methods.set('assignWorkerTask', jest.fn());
    this.methods.set('getWorkerInstance', jest.fn());
    this.methods.set('releaseWorker', jest.fn());
    this.methods.set('initializePool', jest.fn());
    this.methods.set('shutdown', jest.fn());
    this.methods.set('storeTaskResult', jest.fn());
    this.methods.set('getTaskResult', jest.fn());
    this.methods.set('clearTaskResult', jest.fn());
    this.methods.set('getWorkspaceManager', jest.fn(() => ({
      // Mock WorkspaceManager
      getWorkspaceInfo: jest.fn(),
      createWorkspace: jest.fn(),
      cleanupWorkspace: jest.fn()
    })));
  }

  withWorker(worker: Worker): this {
    this.workers.set(worker.id, worker);
    return this;
  }

  withGetWorkerByTaskId(implementation?: (taskId: string) => Promise<Worker | null>): this {
    this.methods.set('getWorkerByTaskId', jest.fn(implementation));
    return this;
  }

  withGetAvailableWorker(implementation?: () => Promise<Worker | null>): this {
    this.methods.set('getAvailableWorker', jest.fn(implementation));
    return this;
  }

  withAssignWorkerTask(implementation?: (workerId: string, task: WorkerTask) => Promise<void>): this {
    this.methods.set('assignWorkerTask', jest.fn(implementation));
    return this;
  }

  withGetWorkerInstance(implementation?: (workerId: string) => Promise<any>): this {
    this.methods.set('getWorkerInstance', jest.fn(implementation));
    return this;
  }

  build(): jest.Mocked<WorkerPoolManager> {
    const manager: any = {};
    
    // 모든 메소드 추가
    this.methods.forEach((mock, name) => {
      manager[name] = mock;
    });
    
    // workers 참조 추가 (테스트용)
    manager._testWorkers = this.workers;
    
    return manager as jest.Mocked<WorkerPoolManager>;
  }
}

/**
 * Planner Mock Builder
 */
export class MockPlannerBuilder {
  private methods: Map<string, jest.Mock> = new Map();
  private boardItems: ProjectBoardItem[] = [];

  constructor() {
    this.methods.set('start', jest.fn());
    this.methods.set('stop', jest.fn());
    this.methods.set('getBoardItems', jest.fn());
    this.methods.set('updateTaskStatus', jest.fn());
  }

  withBoardItem(item: ProjectBoardItem): this {
    this.boardItems.push(item);
    return this;
  }

  withStart(implementation?: () => Promise<void>): this {
    this.methods.set('start', jest.fn(implementation));
    return this;
  }

  withStop(implementation?: () => Promise<void>): this {
    this.methods.set('stop', jest.fn(implementation));
    return this;
  }

  withGetBoardItems(implementation?: () => Promise<ProjectBoardItem[]>): this {
    const impl = implementation || (() => Promise.resolve(this.boardItems));
    this.methods.set('getBoardItems', jest.fn(impl));
    return this;
  }

  build(): jest.Mocked<Planner> {
    const planner: any = {};
    
    this.methods.forEach((mock, name) => {
      planner[name] = mock;
    });
    
    return planner as jest.Mocked<Planner>;
  }
}

/**
 * 복합 Mock Builder (여러 서비스를 함께 구성)
 */
export class MockEnvironmentBuilder {
  private logger?: jest.Mocked<Logger>;
  private workerPoolManager?: jest.Mocked<WorkerPoolManager>;
  private planner?: jest.Mocked<Planner>;

  withLogger(builder: MockLoggerBuilder): this {
    this.logger = builder.build();
    return this;
  }

  withWorkerPoolManager(builder: MockWorkerPoolManagerBuilder): this {
    this.workerPoolManager = builder.build();
    return this;
  }

  withPlanner(builder: MockPlannerBuilder): this {
    this.planner = builder.build();
    return this;
  }

  build() {
    return {
      logger: this.logger || new MockLoggerBuilder().build(),
      workerPoolManager: this.workerPoolManager || new MockWorkerPoolManagerBuilder().build(),
      planner: this.planner || new MockPlannerBuilder().build()
    };
  }
}
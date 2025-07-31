import { AIDevTeamApp } from '../../src/app';
import { WorkerPoolManager } from '../../src/services/manager/worker-pool-manager';
import { Planner } from '../../src/services/planner';
import { Logger } from '../../src/services/logger';
import { ResponseStatus } from '../../src/types/planner.types';
import { WorkerStatus } from '../../src/types/worker.types';
import { AppConfig } from '../../src/config/app-config';
import { ServiceProvider } from '../../src/types/provider.types';

// Mock dependencies
jest.mock('../../src/services/manager/worker-pool-manager');
jest.mock('../../src/services/planner');
jest.mock('../../src/services/logger');

describe('AIDevTeamApp - Worker execution fixes', () => {
  let app: AIDevTeamApp;
  let mockWorkerPoolManager: jest.Mocked<WorkerPoolManager>;
  let mockLogger: jest.Mocked<Logger>;
  let mockPlanner: jest.Mocked<Planner>;

  const mockConfig: AppConfig = {
    nodeEnv: 'test',
    planner: {
      boardId: 'test-board-id',
      repoId: 'test-owner/test-repo',
      monitoringIntervalMs: 15000,
      maxRetryAttempts: 3,
      timeoutMs: 60000,
      repositoryFilter: {
        allowedRepositories: ['test-owner/test-repo'],
        mode: 'whitelist'
      },
      pullRequestFilter: {
        allowedBots: ['dependabot[bot]'],
        excludeAuthor: true
      }
    },
    manager: {
      workspaceRoot: '/tmp/test',
      workerPool: {
        minWorkers: 1,
        maxWorkers: 2,
        workerTimeoutMs: 300000
      },
      gitOperationTimeoutMs: 60000,
      repositoryCacheTimeoutMs: 300000,
      gitConfig: {
        cloneDepth: 1,
        enableConcurrencyLock: true
      },
      pullRequest: {
        provider: ServiceProvider.GITHUB,
        config: {
          type: ServiceProvider.GITHUB,
          apiToken: 'test-token',
          baseUrl: 'https://api.github.com'
        }
      }
    },
    developer: {
      claudeCodePath: 'claude',
      claudeCodeTimeoutMs: 300000,
      geminiCliPath: 'gemini',
      geminiCliTimeoutMs: 300000
    },
    logger: {
      level: 'info',
      filePath: './logs/test.log',
      enableConsole: true
    },
    pullRequestFilter: {
      allowedBots: ['dependabot[bot]'],
      excludeAuthor: true
    }
  };

  const mockWorker = {
    id: 'worker-123',
    status: WorkerStatus.IDLE,
    workspaceDir: '/tmp/test/worker-123',
    developerType: 'claude' as const,
    createdAt: new Date(),
    lastActiveAt: new Date()
  };

  const mockRequest = {
    taskId: 'PVTI_test123',
    action: 'request_merge' as const,
    pullRequestUrl: 'https://github.com/wlgns5376/ai-devteam-test/pull/5',
    boardItem: {
      id: 'PVTI_test123',
      title: 'Test Task',
      content: 'Test content',
      repository: 'test/repo',
      status: 'IN_REVIEW'
    }
  };

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Setup mocked dependencies
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    const mockWorkerInstance = {
      getStatus: jest.fn().mockReturnValue(WorkerStatus.IDLE),
      getCurrentTask: jest.fn().mockReturnValue(null),
      startExecution: jest.fn().mockResolvedValue({ success: true, pullRequestUrl: 'https://github.com/test/repo/pull/1' })
    };

    mockWorkerPoolManager = {
      getWorkerByTaskId: jest.fn(),
      getAvailableWorker: jest.fn(),
      assignWorkerTask: jest.fn(),
      getWorkerInstance: jest.fn().mockResolvedValue(mockWorkerInstance),
      releaseWorker: jest.fn(),
      initializePool: jest.fn(),
      shutdown: jest.fn()
    } as any;

    mockPlanner = {
      start: jest.fn(),
      stop: jest.fn()
    } as any;

    // Create app instance
    app = new AIDevTeamApp(mockConfig);
    (app as any).logger = mockLogger;
    (app as any).workerPoolManager = mockWorkerPoolManager;
    (app as any).planner = mockPlanner;
    (app as any).isInitialized = true;
    
    // public handleTaskRequest를 위해 workerPoolManager를 직접 설정
    app['workerPoolManager'] = mockWorkerPoolManager;
    // extractRepositoryFromBoardItem을 실제 구현으로 유지
  });

  describe('handleTaskRequest - request_merge with existing worker', () => {
    it('기존 worker가 있을 때 merge 요청을 성공적으로 처리하고 즉시 실행해야 한다', async () => {
      // Given
      mockWorkerPoolManager.getWorkerByTaskId.mockResolvedValue(mockWorker);

      // When
      const result = await (app as any).handleTaskRequest(mockRequest);

      // Then
      expect(mockWorkerPoolManager.getWorkerByTaskId).toHaveBeenCalledWith(mockRequest.taskId);
      expect(mockWorkerPoolManager.assignWorkerTask).toHaveBeenCalledWith(mockWorker.id, {
        taskId: mockRequest.taskId,
        action: 'merge_request',
        pullRequestUrl: mockRequest.pullRequestUrl,
        boardItem: mockRequest.boardItem,
        repositoryId: 'wlgns5376/ai-devteam-test',
        assignedAt: expect.any(Date)
      });
      expect(mockWorkerPoolManager.getWorkerInstance).toHaveBeenCalledWith(mockWorker.id, undefined);
      expect(mockLogger.info).toHaveBeenCalledWith('Merge request task assigned and started', {
        taskId: mockRequest.taskId,
        workerId: mockWorker.id,
        pullRequestUrl: mockRequest.pullRequestUrl
      });
      expect(result).toEqual({
        taskId: mockRequest.taskId,
        status: ResponseStatus.ACCEPTED,
        message: 'Merge request processing started',
        workerStatus: 'processing_merge'
      });
    });

    it('Worker가 이미 작업 중일 때 중복 처리를 방지해야 한다', async () => {
      // Given
      const busyWorker = { ...mockWorker, status: WorkerStatus.WORKING };
      const mockBusyWorkerInstance = {
        getStatus: jest.fn().mockReturnValue(WorkerStatus.WORKING),
        getCurrentTask: jest.fn().mockReturnValue({ taskId: mockRequest.taskId }),
        startExecution: jest.fn()
      } as any;
      
      mockWorkerPoolManager.getWorkerByTaskId.mockResolvedValue(busyWorker);
      mockWorkerPoolManager.getWorkerInstance.mockResolvedValue(mockBusyWorkerInstance);

      // When
      const result = await (app as any).handleTaskRequest(mockRequest);

      // Then
      expect(mockWorkerPoolManager.getWorkerByTaskId).toHaveBeenCalledWith(mockRequest.taskId);
      expect(mockWorkerPoolManager.getWorkerInstance).toHaveBeenCalledWith(busyWorker.id, undefined);
      expect(mockBusyWorkerInstance.getStatus).toHaveBeenCalled();
      expect(mockWorkerPoolManager.assignWorkerTask).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Worker already processing merge request', {
        taskId: mockRequest.taskId,
        workerId: busyWorker.id,
        status: WorkerStatus.WORKING
      });
      expect(result).toEqual({
        taskId: mockRequest.taskId,
        status: ResponseStatus.ACCEPTED,
        message: 'Merge request already being processed',
        workerStatus: 'already_processing'
      });
    });
  });

  describe('handleTaskRequest - request_merge without existing worker', () => {
    it('기존 worker가 없을 때 새로운 worker를 할당해서 merge 요청을 처리해야 한다', async () => {
      // Given
      mockWorkerPoolManager.getWorkerByTaskId.mockResolvedValue(null);
      mockWorkerPoolManager.getAvailableWorker.mockResolvedValue(mockWorker);

      // When
      const result = await (app as any).handleTaskRequest(mockRequest);

      // Then
      expect(mockWorkerPoolManager.getWorkerByTaskId).toHaveBeenCalledWith(mockRequest.taskId);
      expect(mockWorkerPoolManager.getAvailableWorker).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Assigned new worker for merge request', {
        taskId: mockRequest.taskId,
        workerId: mockWorker.id
      });
      expect(mockWorkerPoolManager.assignWorkerTask).toHaveBeenCalledWith(mockWorker.id, {
        taskId: mockRequest.taskId,
        action: 'merge_request',
        pullRequestUrl: mockRequest.pullRequestUrl,
        boardItem: mockRequest.boardItem,
        repositoryId: 'wlgns5376/ai-devteam-test',
        assignedAt: expect.any(Date)
      });
      expect(result).toEqual({
        taskId: mockRequest.taskId,
        status: ResponseStatus.ACCEPTED,
        message: 'Merge request processing started',
        workerStatus: 'processing_merge'
      });
    });

    it('기존 worker가 없고 사용 가능한 worker도 없을 때 에러를 반환해야 한다', async () => {
      // Given
      mockWorkerPoolManager.getWorkerByTaskId.mockResolvedValue(null);
      mockWorkerPoolManager.getAvailableWorker.mockResolvedValue(null);

      // When
      const result = await (app as any).handleTaskRequest(mockRequest);

      // Then
      expect(mockWorkerPoolManager.getWorkerByTaskId).toHaveBeenCalledWith(mockRequest.taskId);
      expect(mockWorkerPoolManager.getAvailableWorker).toHaveBeenCalled();
      expect(mockWorkerPoolManager.assignWorkerTask).not.toHaveBeenCalled();
      expect(result).toEqual({
        taskId: mockRequest.taskId,
        status: ResponseStatus.ERROR,
        message: 'No available worker for merge request',
        workerStatus: 'no_available_worker'
      });
    });
  });

  describe('extractRepositoryFromBoardItem', () => {
    it('PR URL에서 저장소 ID를 올바르게 추출해야 한다', () => {
      // Given
      const pullRequestUrl = 'https://github.com/wlgns5376/ai-devteam-test/pull/5';
      const boardItem = { id: 'test' };

      // When
      const result = (app as any).extractRepositoryFromBoardItem(boardItem, pullRequestUrl);

      // Then
      expect(result).toBe('wlgns5376/ai-devteam-test');
    });

    it('PR URL이 없으면 boardItem의 pullRequestUrls에서 추출해야 한다', () => {
      // Given
      const boardItem = {
        pullRequestUrls: ['https://github.com/owner/repo/pull/1']
      };

      // When
      const result = (app as any).extractRepositoryFromBoardItem(boardItem);

      // Then
      expect(result).toBe('owner/repo');
    });

    it('모든 정보가 없으면 config의 repoId를 사용해야 한다', () => {
      // Given
      const boardItem = {};
      (app as any).config = { planner: { repoId: 'fallback/repo' } };

      // When
      const result = (app as any).extractRepositoryFromBoardItem(boardItem);

      // Then
      expect(result).toBe('fallback/repo');
    });

    it('잘못된 PR URL 형식에서도 안전하게 처리해야 한다', () => {
      // Given
      const pullRequestUrl = 'invalid-url';
      const boardItem = {};
      (app as any).config = { planner: { repoId: 'fallback/repo' } };

      // When
      const result = (app as any).extractRepositoryFromBoardItem(boardItem, pullRequestUrl);

      // Then
      expect(result).toBe('fallback/repo');
    });
  });

  describe('handleTaskRequest - process_feedback with existing worker', () => {
    it('기존 worker가 있을 때 feedback 요청을 성공적으로 처리해야 한다', async () => {
      // Given
      const taskId = 'PVTI_existing_task';
      const comments = [{ id: '1', author: 'bot', content: 'test feedback', createdAt: new Date() }];
      const existingWorker = {
        id: 'worker-1',
        status: WorkerStatus.IDLE,
        currentTask: {
          taskId,
          action: 'start_new_task',
          assignedAt: new Date()
        }
      };
      const mockWorkerInstance = {
        startExecution: jest.fn().mockResolvedValue({ success: true })
      };

      mockWorkerPoolManager.getWorkerByTaskId.mockResolvedValue(existingWorker as any);
      mockWorkerPoolManager.assignWorkerTask.mockResolvedValue(undefined);
      mockWorkerPoolManager.getWorkerInstance.mockResolvedValue(mockWorkerInstance as any);

      // When
      try {
        const result = await app.handleTaskRequest({
          taskId,
          action: 'process_feedback' as any,
          comments
        });
        console.log('Test result 1:', result);
        
        // Then
        expect(result.status).toBe(ResponseStatus.ACCEPTED);
        expect(result.message).toBe('Feedback processing started and execution started');
        expect(result.workerStatus).toBe('processing_feedback');
        expect(mockWorkerPoolManager.getWorkerByTaskId).toHaveBeenCalledWith(taskId);
        expect(mockWorkerPoolManager.assignWorkerTask).toHaveBeenCalledWith('worker-1', {
          ...existingWorker.currentTask,
          action: 'process_feedback' as any,
          comments,
          assignedAt: expect.any(Date)
        });
        expect(mockWorkerInstance.startExecution).toHaveBeenCalled();
      } catch (error) {
        console.error('Test error:', error);
        throw error;
      }
    });
  });

  describe('handleTaskRequest - process_feedback without existing worker', () => {
    it('기존 worker가 없을 때 새로운 worker를 할당해서 feedback 요청을 처리해야 한다', async () => {
      // Given
      const taskId = 'PVTI_no_existing_worker';
      const comments = [{ id: '1', author: 'bot', content: 'test feedback', createdAt: new Date() }];
      const boardItem = { 
        id: taskId, 
        title: 'Test task',
        status: 'TODO',
        assignee: null,
        labels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        pullRequestUrls: []
      } as any;
      const pullRequestUrl = 'https://github.com/owner/repo/pull/1';
      const availableWorker = {
        id: 'worker-2',
        status: WorkerStatus.IDLE,
        currentTask: null
      };
      const mockWorkerInstance = {
        startExecution: jest.fn().mockResolvedValue({ success: true })
      };

      mockWorkerPoolManager.getWorkerByTaskId.mockResolvedValue(null);
      mockWorkerPoolManager.getAvailableWorker.mockResolvedValue(availableWorker as any);
      mockWorkerPoolManager.assignWorkerTask.mockResolvedValue(undefined);
      mockWorkerPoolManager.getWorkerInstance.mockResolvedValue(mockWorkerInstance as any);

      // When
      const result = await app.handleTaskRequest({
        taskId,
        action: 'process_feedback' as any,
        comments,
        boardItem,
        pullRequestUrl
      });

      // Then
      expect(result.status).toBe(ResponseStatus.ACCEPTED);
      expect(result.message).toBe('Feedback processing started and execution started');
      expect(result.workerStatus).toBe('processing_feedback');
      expect(mockWorkerPoolManager.getWorkerByTaskId).toHaveBeenCalledWith(taskId);
      expect(mockWorkerPoolManager.getAvailableWorker).toHaveBeenCalled();
      expect(mockWorkerPoolManager.assignWorkerTask).toHaveBeenCalledWith('worker-2', {
        taskId,
        action: 'process_feedback' as any,
        boardItem,
        pullRequestUrl,
        comments,
        repositoryId: 'owner/repo',
        assignedAt: expect.any(Date)
      });
      expect(mockWorkerInstance.startExecution).toHaveBeenCalled();
    });

    it('기존 worker가 없고 사용 가능한 worker도 없을 때 REJECTED를 반환해야 한다', async () => {
      // Given
      const taskId = 'PVTI_no_workers';
      const comments = [{ id: '1', author: 'bot', content: 'test feedback', createdAt: new Date() }];

      mockWorkerPoolManager.getWorkerByTaskId.mockResolvedValue(null);
      mockWorkerPoolManager.getAvailableWorker.mockResolvedValue(null);

      // When
      const result = await app.handleTaskRequest({
        taskId,
        action: 'process_feedback' as any,
        comments
      });

      // Then
      expect(result.status).toBe(ResponseStatus.REJECTED);
      expect(result.message).toBe('No available workers for feedback processing');
      expect(result.workerStatus).toBe('unavailable');
      expect(mockWorkerPoolManager.getWorkerByTaskId).toHaveBeenCalledWith(taskId);
      expect(mockWorkerPoolManager.getAvailableWorker).toHaveBeenCalled();
      expect(mockWorkerPoolManager.assignWorkerTask).not.toHaveBeenCalled();
    });
  });
});
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

describe('AIDevTeamApp - request_merge action', () => {
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
    pullRequestUrl: 'https://github.com/test/repo/pull/1',
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

    mockWorkerPoolManager = {
      getWorkerByTaskId: jest.fn(),
      getAvailableWorker: jest.fn(),
      assignWorkerTask: jest.fn(),
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
    (app as any).extractRepositoryFromBoardItem = jest.fn().mockReturnValue('test/repo');
  });

  describe('handleTaskRequest - request_merge with existing worker', () => {
    it('기존 worker가 있을 때 merge 요청을 성공적으로 처리해야 한다', async () => {
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
        repositoryId: 'test/repo',
        assignedAt: expect.any(Date)
      });
      expect(mockLogger.info).toHaveBeenCalledWith('Merge request task assigned to worker', {
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
        repositoryId: 'test/repo',
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
});
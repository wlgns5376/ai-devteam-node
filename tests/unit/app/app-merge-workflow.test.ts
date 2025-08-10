/**
 * AIDevTeamApp - Merge Workflow 테스트
 * PR 병합 관련 워크플로우 테스트
 */

import { AIDevTeamApp } from '@/app';
import { ResponseStatus } from '@/types/planner.types';
import { WorkerStatus } from '@/types/worker.types';
import { TestDataFactory } from '../../helpers/test-data-factory';
import { 
  MockWorkerPoolManagerBuilder, 
  MockLoggerBuilder,
  MockPlannerBuilder,
  MockWorkerBuilder 
} from '../../helpers/mock-builders';
import { TaskRequestHandler } from '@/app/TaskRequestHandler';
import { RepositoryInfoExtractor } from '@/utils/RepositoryInfoExtractor';

describe('AIDevTeamApp - Merge Workflow', () => {
  let app: AIDevTeamApp;
  let mockWorkerPoolManager: ReturnType<MockWorkerPoolManagerBuilder['build']>;
  let mockLogger: ReturnType<MockLoggerBuilder['build']>;
  let mockPlanner: ReturnType<MockPlannerBuilder['build']>;

  const mockConfig = TestDataFactory.createMockConfig();

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock 빌더를 사용한 설정
    mockLogger = new MockLoggerBuilder().build();
    mockPlanner = new MockPlannerBuilder().build();
    
    const mockWorkerInstance = {
      getStatus: jest.fn().mockReturnValue(WorkerStatus.IDLE),
      getCurrentTask: jest.fn().mockReturnValue(null),
      startExecution: jest.fn().mockResolvedValue({ 
        success: true, 
        pullRequestUrl: 'https://github.com/test/repo/pull/1' 
      })
    };

    mockWorkerPoolManager = new MockWorkerPoolManagerBuilder()
      .withGetWorkerInstance(() => Promise.resolve(mockWorkerInstance))
      .build();

    // App 인스턴스 생성 및 mock 주입
    app = new AIDevTeamApp(mockConfig);
    (app as any).logger = mockLogger;
    (app as any).workerPoolManager = mockWorkerPoolManager;
    (app as any).planner = mockPlanner;
    (app as any).isInitialized = true;
    
    // TaskRequestHandler 수동 초기화 (테스트용)
    const extractRepositoryFromBoardItem = (boardItem: any, pullRequestUrl?: string) => {
      return RepositoryInfoExtractor.extractRepositoryFromBoardItem(
        boardItem, 
        pullRequestUrl, 
        mockConfig.planner?.repoId
      );
    };
    
    (app as any).taskRequestHandler = new TaskRequestHandler(
      mockWorkerPoolManager,
      undefined, // projectBoardService
      undefined, // pullRequestService 
      mockLogger,
      extractRepositoryFromBoardItem
    );
  });

  describe('request_merge with existing worker', () => {
    const mockWorker = TestDataFactory.createMockWorker({
      id: 'worker-123',
      status: WorkerStatus.IDLE
    });

    const mockRequest = TestDataFactory.createMockTaskRequest({
      action: 'request_merge' as any,
      pullRequestUrl: 'https://github.com/wlgns5376/ai-devteam-test/pull/5'
    });

    it('기존 worker가 있을 때 merge 요청을 성공적으로 처리하고 즉시 실행해야 한다', async () => {
      // Given
      mockWorkerPoolManager.getWorkerByTaskId.mockResolvedValue(mockWorker);

      // When
      const result = await (app as any).handleTaskRequest(mockRequest);

      // Then
      expect(mockWorkerPoolManager.getWorkerByTaskId).toHaveBeenCalledWith(mockRequest.taskId);
      expect(mockWorkerPoolManager.assignWorkerTask).toHaveBeenCalledWith(
        mockWorker.id,
        expect.objectContaining({
          taskId: mockRequest.taskId,
          action: 'merge_request',
          pullRequestUrl: mockRequest.pullRequestUrl,
          boardItem: mockRequest.boardItem,
          repositoryId: 'wlgns5376/ai-devteam-test'
        })
      );
      expect(mockWorkerPoolManager.getWorkerInstance).toHaveBeenCalledWith(mockWorker.id, undefined);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Merge request task assigned and started',
        expect.objectContaining({
          taskId: mockRequest.taskId,
          workerId: mockWorker.id,
          pullRequestUrl: mockRequest.pullRequestUrl
        })
      );
      expect(result).toEqual({
        taskId: mockRequest.taskId,
        status: ResponseStatus.ACCEPTED,
        message: 'Merge request processing started',
        workerStatus: 'processing_merge'
      });
    });

    it('Worker가 이미 작업 중일 때 중복 처리를 방지해야 한다', async () => {
      // Given
      const busyWorker = TestDataFactory.createMockWorker({
        ...mockWorker,
        status: WorkerStatus.WORKING
      });
      
      const mockBusyWorkerInstance = {
        getStatus: jest.fn().mockReturnValue(WorkerStatus.WORKING),
        getCurrentTask: jest.fn().mockReturnValue({ taskId: mockRequest.taskId }),
        startExecution: jest.fn()
      };
      
      mockWorkerPoolManager.getWorkerByTaskId.mockResolvedValue(busyWorker);
      mockWorkerPoolManager.getWorkerInstance.mockResolvedValue(mockBusyWorkerInstance as any);

      // When
      const result = await (app as any).handleTaskRequest(mockRequest);

      // Then
      expect(mockWorkerPoolManager.getWorkerByTaskId).toHaveBeenCalledWith(mockRequest.taskId);
      expect(mockWorkerPoolManager.getWorkerInstance).toHaveBeenCalledWith(busyWorker.id, undefined);
      expect(mockBusyWorkerInstance.getStatus).toHaveBeenCalled();
      expect(mockWorkerPoolManager.assignWorkerTask).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Worker already processing merge request',
        expect.objectContaining({
          taskId: mockRequest.taskId,
          workerId: busyWorker.id,
          status: WorkerStatus.WORKING
        })
      );
      expect(result).toEqual({
        taskId: mockRequest.taskId,
        status: ResponseStatus.ACCEPTED,
        message: 'Merge request already being processed',
        workerStatus: 'already_processing'
      });
    });
  });

  describe('request_merge without existing worker', () => {
    const mockWorker = TestDataFactory.createMockWorker({
      id: 'worker-456',
      status: WorkerStatus.IDLE
    });

    const mockRequest = TestDataFactory.createMockTaskRequest({
      action: 'request_merge' as any,
      pullRequestUrl: 'https://github.com/wlgns5376/ai-devteam-test/pull/5'
    });

    it('기존 worker가 없을 때 새로운 worker를 할당해서 merge 요청을 처리해야 한다', async () => {
      // Given
      mockWorkerPoolManager.getWorkerByTaskId.mockResolvedValue(null);
      mockWorkerPoolManager.getAvailableWorker.mockResolvedValue(mockWorker);

      // When
      const result = await (app as any).handleTaskRequest(mockRequest);

      // Then
      expect(mockWorkerPoolManager.getWorkerByTaskId).toHaveBeenCalledWith(mockRequest.taskId);
      expect(mockWorkerPoolManager.getAvailableWorker).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Assigned new worker for merge request',
        expect.objectContaining({
          taskId: mockRequest.taskId,
          workerId: mockWorker.id
        })
      );
      expect(mockWorkerPoolManager.assignWorkerTask).toHaveBeenCalledWith(
        mockWorker.id,
        expect.objectContaining({
          taskId: mockRequest.taskId,
          action: 'merge_request',
          pullRequestUrl: mockRequest.pullRequestUrl,
          boardItem: mockRequest.boardItem,
          repositoryId: 'wlgns5376/ai-devteam-test'
        })
      );
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
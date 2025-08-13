/**
 * AIDevTeamApp - Feedback Handling 테스트
 * PR 피드백 처리 관련 테스트
 */

import { AIDevTeamApp } from '@/app';
import { ResponseStatus } from '@/types/planner.types';
import { WorkerStatus, WorkerAction } from '@/types/worker.types';
import { TestDataFactory } from '../../helpers/test-data-factory';
import { 
  MockWorkerPoolManagerBuilder, 
  MockLoggerBuilder,
  MockPlannerBuilder 
} from '../../helpers/mock-builders';
import { TaskRequestHandler } from '@/app/TaskRequestHandler';
import { RepositoryInfoExtractor } from '@/utils/RepositoryInfoExtractor';

describe('AIDevTeamApp - Feedback Handling', () => {
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
      startExecution: jest.fn().mockResolvedValue({ success: true })
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

  describe('process_feedback with existing worker', () => {
    it('기존 worker가 있을 때 feedback 요청을 성공적으로 처리해야 한다', async () => {
      // Given
      const taskId = 'PVTI_existing_task';
      const comments = [TestDataFactory.createMockComment({
        id: '1',
        author: 'reviewer',
        content: 'Please fix this issue'
      })];
      
      const existingWorker = TestDataFactory.createMockWorker({
        id: 'worker-1',
        status: WorkerStatus.IDLE,
        currentTask: TestDataFactory.createMockWorkerTask({
          taskId,
          action: WorkerAction.START_NEW_TASK
        })
      });

      mockWorkerPoolManager.getWorkerByTaskId.mockResolvedValue(existingWorker);
      mockWorkerPoolManager.assignWorkerTask.mockResolvedValue(undefined);

      // When
      const result = await app.handleTaskRequest({
        taskId,
        action: 'process_feedback' as any,
        comments
      });

      // Then
      expect(result.status).toBe(ResponseStatus.ACCEPTED);
      expect(result.message).toBe('Feedback processing started and execution started');
      expect(result.workerStatus).toBe('processing_feedback');
      expect(mockWorkerPoolManager.getWorkerByTaskId).toHaveBeenCalledWith(taskId);
      expect(mockWorkerPoolManager.assignWorkerTask).toHaveBeenCalledWith(
        'worker-1',
        expect.objectContaining({
          action: 'process_feedback',
          comments,
          assignedAt: expect.any(Date)
        })
      );
    });
  });

  describe('process_feedback without existing worker', () => {
    it('기존 worker가 없을 때 새로운 worker를 할당해서 feedback 요청을 처리해야 한다', async () => {
      // Given
      const taskId = 'PVTI_no_existing_worker';
      const comments = [TestDataFactory.createMockComment({
        id: '2',
        author: 'reviewer',
        content: 'LGTM with minor changes'
      })];
      
      const boardItem = TestDataFactory.createMockBoardItem({
        id: taskId,
        pullRequestUrls: ['https://github.com/owner/repo/pull/1']
      });
      
      const availableWorker = TestDataFactory.createMockWorker({
        id: 'worker-2',
        status: WorkerStatus.IDLE
      });

      mockWorkerPoolManager.getWorkerByTaskId.mockResolvedValue(null);
      mockWorkerPoolManager.getAvailableWorker.mockResolvedValue(availableWorker);
      mockWorkerPoolManager.assignWorkerTask.mockResolvedValue(undefined);

      // When
      const result = await app.handleTaskRequest({
        taskId,
        action: 'process_feedback' as any,
        comments,
        boardItem,
        pullRequestUrl: 'https://github.com/owner/repo/pull/1'
      });

      // Then
      expect(result.status).toBe(ResponseStatus.ACCEPTED);
      expect(result.message).toBe('Feedback processing started and execution started');
      expect(result.workerStatus).toBe('processing_feedback');
      expect(mockWorkerPoolManager.getWorkerByTaskId).toHaveBeenCalledWith(taskId);
      expect(mockWorkerPoolManager.getAvailableWorker).toHaveBeenCalled();
      expect(mockWorkerPoolManager.assignWorkerTask).toHaveBeenCalledWith(
        'worker-2',
        expect.objectContaining({
          taskId,
          action: 'process_feedback',
          boardItem,
          pullRequestUrl: 'https://github.com/owner/repo/pull/1',
          comments,
          repositoryId: 'owner/repo',
          assignedAt: expect.any(Date)
        })
      );
    });

    it('기존 worker가 없고 사용 가능한 worker도 없을 때 REJECTED를 반환해야 한다', async () => {
      // Given
      const taskId = 'PVTI_no_workers';
      const comments = [TestDataFactory.createMockComment()];

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
      const boardItem = TestDataFactory.createMockBoardItem({
        pullRequestUrls: ['https://github.com/owner/repo/pull/1']
      });

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

  describe('Worker 상태 관리 - PR 생성 후 피드백 대기', () => {
    it('PR 생성 완료 후 Worker가 WAITING 상태로 유지되어야 한다', async () => {
      // Given: PR 생성이 성공하는 Worker 인스턴스
      const taskId = 'PVTI_pr_created_task';
      const worker = TestDataFactory.createMockWorker({
        id: 'worker-waiting-test',
        status: WorkerStatus.WAITING,
        currentTask: {
          taskId,
          action: WorkerAction.START_NEW_TASK,
          assignedAt: new Date(),
          repositoryId: 'test-owner/test-repo'
        }
      });

      mockWorkerPoolManager.getWorkerByTaskId.mockResolvedValue(worker);
      mockWorkerPoolManager.releaseWorker.mockResolvedValue(undefined);

      // WorkerTaskExecutor mock 설정
      const mockWorkerTaskExecutor = {
        executeWorkerTask: jest.fn().mockResolvedValue({
          success: true,
          pullRequestUrl: 'https://github.com/owner/repo/pull/123'
        })
      };
      (app as any).workerTaskExecutor = mockWorkerTaskExecutor;

      // When: check_status 요청을 처리하면
      const result = await app.handleTaskRequest({
        taskId,
        action: 'check_status' as any
      });

      // Debug: 결과 확인
      console.log('Test result:', result);
      console.log('executeWorkerTask was called with:', mockWorkerTaskExecutor.executeWorkerTask.mock.calls);

      // Then: Worker는 해제되지 않고 waiting_for_review 상태가 되어야 함
      expect(result.status).toBe(ResponseStatus.COMPLETED);
      expect(result.workerStatus).toBe('waiting_for_review');
      expect(result.pullRequestUrl).toBe('https://github.com/owner/repo/pull/123');
      
      // Worker가 해제되지 않았는지 확인
      expect(mockWorkerPoolManager.releaseWorker).not.toHaveBeenCalled();
    });

    it('reassignTask에서도 PR 생성 완료 후 Worker가 해제되지 않아야 한다', async () => {
      // Given: Worker가 없어서 재할당이 필요한 상황
      const taskId = 'PVTI_reassign_task';
      const availableWorker = TestDataFactory.createMockWorker({
        id: 'worker-reassign-test',
        status: WorkerStatus.IDLE
      });

      const mockWorkerInstance = {
        startExecution: jest.fn().mockResolvedValue({ 
          success: true, 
          pullRequestUrl: 'https://github.com/owner/repo/pull/456'
        })
      } as any;

      mockWorkerPoolManager.getWorkerByTaskId.mockResolvedValue(null); // 기존 Worker 없음
      mockWorkerPoolManager.getAvailableWorker.mockResolvedValue(availableWorker);
      mockWorkerPoolManager.assignWorkerTask.mockResolvedValue(undefined);
      mockWorkerPoolManager.getWorkerInstance.mockResolvedValue(mockWorkerInstance);
      mockWorkerPoolManager.releaseWorker.mockResolvedValue(undefined);

      // When: check_status 요청을 처리하면 (내부적으로 reassignTask 호출)
      const result = await app.handleTaskRequest({
        taskId,
        action: 'check_status' as any,
        boardItem: TestDataFactory.createMockBoardItem()
      });

      // Then: Worker는 해제되지 않고 waiting_for_review 상태가 되어야 함
      expect(result.status).toBe(ResponseStatus.COMPLETED);
      expect(result.workerStatus).toBe('waiting_for_review');
      expect(result.pullRequestUrl).toBe('https://github.com/owner/repo/pull/456');
      
      // Worker가 해제되지 않았는지 확인
      expect(mockWorkerPoolManager.releaseWorker).not.toHaveBeenCalled();
    });
  });
});
import { ReviewTaskHandler } from '@/services/planner/review-task-handler';
import { WorkflowStateManager } from '@/services/planner/workflow-state-manager';
import { PlannerErrorManager } from '@/services/planner/planner-error-manager';
import { Logger } from '@/services/logger';
import { 
  PlannerServiceConfig,
  ResponseStatus,
  PullRequestState,
  PullRequestComment,
  ReviewState
} from '@/types';

describe('ReviewTaskHandler 방어 로직 테스트', () => {
  let reviewTaskHandler: ReviewTaskHandler;
  let mockDependencies: any;
  let mockWorkflowStateManager: any;
  let mockErrorManager: any;
  let mockLogger: Logger;
  let mockConfig: PlannerServiceConfig;

  beforeEach(() => {
    // Mock dependencies
    mockDependencies = {
      projectBoardService: {
        getItems: jest.fn().mockResolvedValue([]),
        updateItemStatus: jest.fn().mockResolvedValue(undefined),
        addPullRequestToItem: jest.fn().mockResolvedValue(undefined),
      },
      pullRequestService: {
        getPullRequest: jest.fn().mockResolvedValue({ status: PullRequestState.OPEN }),
        isApproved: jest.fn().mockResolvedValue(false),
        getReviews: jest.fn().mockResolvedValue([]),
        getNewComments: jest.fn().mockResolvedValue([]),
      },
      stateManager: {
        getTaskLastSyncTime: jest.fn().mockResolvedValue(null),
        updateTaskLastSyncTime: jest.fn().mockResolvedValue(undefined),
        getProcessedCommentsForTask: jest.fn().mockResolvedValue([]),
        addProcessedCommentsToTask: jest.fn().mockResolvedValue(undefined),
        getTaskRetryCount: jest.fn().mockResolvedValue(0),
        incrementTaskRetryCount: jest.fn().mockResolvedValue(undefined),
        addTaskFailureReason: jest.fn().mockResolvedValue(undefined),
        resetTaskRetryCount: jest.fn().mockResolvedValue(undefined),
      },
      managerCommunicator: {
        sendTaskToManager: jest.fn().mockResolvedValue({ status: ResponseStatus.ACCEPTED }),
      }
    };

    // Mock workflow state manager
    mockWorkflowStateManager = {
      getState: jest.fn().mockReturnValue({
        processedComments: new Set(),
      }),
      updateActiveTaskStatus: jest.fn(),
      removeActiveTask: jest.fn(),
    };

    // Mock error manager
    mockErrorManager = {
      addError: jest.fn(),
    };

    // Mock logger
    mockLogger = Logger.createConsoleLogger();
    jest.spyOn(mockLogger, 'debug').mockImplementation();
    jest.spyOn(mockLogger, 'info').mockImplementation();
    jest.spyOn(mockLogger, 'warn').mockImplementation();
    jest.spyOn(mockLogger, 'error').mockImplementation();

    // Mock config
    mockConfig = {
      boardId: 'test-board',
      repoId: 'test-repo',
      monitoringIntervalMs: 1000,
      maxRetryAttempts: 3,
      timeoutMs: 5000,
    };

    // Create ReviewTaskHandler instance
    reviewTaskHandler = new ReviewTaskHandler(
      mockConfig,
      mockDependencies,
      mockWorkflowStateManager,
      mockErrorManager,
      mockLogger
    );
  });

  describe('lastSyncTime null 처리 방어 로직', () => {
    it('getTaskLastSyncTime이 null을 반환해도 기본값으로 처리되어야 한다', async () => {
      // Given: lastSyncTime이 null인 경우
      const reviewItem = {
        id: 'task-null-sync',
        title: 'Task with null syncTime',
        pullRequestUrls: ['https://github.com/owner/repo/pull/10']
      };
      
      mockDependencies.projectBoardService.getItems.mockResolvedValue([reviewItem]);
      mockDependencies.stateManager.getTaskLastSyncTime.mockResolvedValue(null);
      
      const comments: PullRequestComment[] = [
        {
          id: 'comment-1',
          content: 'Test comment',
          author: 'reviewer1',
          createdAt: new Date(),
        }
      ];
      
      mockDependencies.pullRequestService.getNewComments.mockResolvedValue(comments);

      // When: 리뷰 작업 처리
      await reviewTaskHandler.handle();

      // Then: 기본값(7일 전)으로 코멘트를 조회했는지 확인
      expect(mockDependencies.pullRequestService.getNewComments).toHaveBeenCalledWith(
        'owner/repo',
        10,
        expect.any(Date),
        expect.any(Object)
      );
      
      const calledDate = mockDependencies.pullRequestService.getNewComments.mock.calls[0][2];
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      expect(calledDate.getTime()).toBeGreaterThanOrEqual(sevenDaysAgo - 1000); // 1초 오차 허용
      expect(calledDate.getTime()).toBeLessThanOrEqual(sevenDaysAgo + 1000);
    });

    it('getTaskLastSyncTime이 예외를 던져도 안전하게 처리되어야 한다', async () => {
      // Given: getTaskLastSyncTime이 예외를 던지는 경우
      const reviewItem = {
        id: 'task-error-sync',
        title: 'Task with error syncTime',
        pullRequestUrls: ['https://github.com/owner/repo/pull/11']
      };
      
      mockDependencies.projectBoardService.getItems.mockResolvedValue([reviewItem]);
      mockDependencies.stateManager.getTaskLastSyncTime.mockRejectedValue(new Error('Database error'));
      
      const comments: PullRequestComment[] = [
        {
          id: 'comment-1',
          content: 'Test comment',
          author: 'reviewer1',
          createdAt: new Date(),
        }
      ];
      
      mockDependencies.pullRequestService.getNewComments.mockResolvedValue(comments);

      // When: 리뷰 작업 처리
      await reviewTaskHandler.handle();

      // Then: 경고 로그는 남기지만 처리는 계속되어야 함
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to get task lastSyncTime, using default',
        expect.objectContaining({
          taskId: 'task-error-sync',
          error: 'Database error'
        })
      );
      
      // 기본값으로 코멘트를 조회했는지 확인
      expect(mockDependencies.pullRequestService.getNewComments).toHaveBeenCalled();
    });

    it('lastSyncTime이 미래 시간인 경우 현재 시간으로 제한되어야 한다', async () => {
      // Given: lastSyncTime이 미래인 경우
      const reviewItem = {
        id: 'task-future-sync',
        title: 'Task with future syncTime',
        pullRequestUrls: ['https://github.com/owner/repo/pull/12']
      };
      
      const futureTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1일 후
      mockDependencies.projectBoardService.getItems.mockResolvedValue([reviewItem]);
      mockDependencies.stateManager.getTaskLastSyncTime.mockResolvedValue(futureTime);
      
      mockDependencies.pullRequestService.getNewComments.mockResolvedValue([]);

      // When: 리뷰 작업 처리
      await reviewTaskHandler.handle();

      // Then: 현재 시간보다 미래가 아닌 시간으로 조회해야 함
      expect(mockDependencies.pullRequestService.getNewComments).toHaveBeenCalled();
      const calledDate = mockDependencies.pullRequestService.getNewComments.mock.calls[0][2];
      expect(calledDate.getTime()).toBeLessThanOrEqual(Date.now() + 1000); // 1초 오차 허용
    });
  });

  describe('processedCommentIds null 처리 방어 로직', () => {
    it('getProcessedCommentsForTask가 null을 반환해도 빈 배열로 처리되어야 한다', async () => {
      // Given: processedCommentIds가 null인 경우
      const reviewItem = {
        id: 'task-null-comments',
        title: 'Task with null comments',
        pullRequestUrls: ['https://github.com/owner/repo/pull/13']
      };
      
      mockDependencies.projectBoardService.getItems.mockResolvedValue([reviewItem]);
      mockDependencies.stateManager.getProcessedCommentsForTask.mockResolvedValue(null as any);
      
      const comments: PullRequestComment[] = [
        {
          id: 'comment-1',
          content: 'Test comment',
          author: 'reviewer1',
          createdAt: new Date(),
        }
      ];
      
      mockDependencies.pullRequestService.getNewComments.mockResolvedValue(comments);

      // When: 리뷰 작업 처리 (에러 없이 처리되어야 함)
      await expect(reviewTaskHandler.handle()).resolves.not.toThrow();

      // Then: Manager에게 코멘트가 전달되어야 함
      expect(mockDependencies.managerCommunicator.sendTaskToManager).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-null-comments',
          action: 'process_feedback',
          comments: comments
        })
      );
    });

    it('동일한 코멘트가 여러 번 처리되어도 중복 저장되지 않아야 한다', async () => {
      // Given: 동일한 코멘트를 여러 번 처리
      const reviewItem = {
        id: 'task-duplicate-save',
        title: 'Task with duplicate saves',
        pullRequestUrls: ['https://github.com/owner/repo/pull/14']
      };
      
      mockDependencies.projectBoardService.getItems.mockResolvedValue([reviewItem]);
      mockDependencies.stateManager.getProcessedCommentsForTask.mockResolvedValue([]);
      
      const comments: PullRequestComment[] = [
        {
          id: 'comment-1',
          content: 'Test comment',
          author: 'reviewer1',
          createdAt: new Date(),
        }
      ];
      
      mockDependencies.pullRequestService.getNewComments.mockResolvedValue(comments);

      // When: 두 번 연속 처리
      await reviewTaskHandler.handle();
      
      // 첫 번째 처리 후 processedCommentIds에 추가됨
      mockDependencies.stateManager.getProcessedCommentsForTask.mockResolvedValue(['comment-1']);
      
      await reviewTaskHandler.handle();

      // Then: 첫 번째만 Manager에게 전달되고, 두 번째는 필터링되어야 함
      expect(mockDependencies.managerCommunicator.sendTaskToManager).toHaveBeenCalledTimes(1);
    });
  });

  describe('동시성 문제 방어 로직', () => {
    it('동시에 여러 ReviewTaskHandler가 실행되어도 안전해야 한다', async () => {
      // Given: 동일한 작업에 대해 여러 핸들러 생성
      const reviewItem = {
        id: 'task-concurrent',
        title: 'Concurrent Task',
        pullRequestUrls: ['https://github.com/owner/repo/pull/15']
      };
      
      mockDependencies.projectBoardService.getItems.mockResolvedValue([reviewItem]);
      mockDependencies.stateManager.getProcessedCommentsForTask.mockResolvedValue([]);
      
      const comments: PullRequestComment[] = [
        {
          id: 'comment-concurrent',
          content: 'Concurrent comment',
          author: 'reviewer1',
          createdAt: new Date(),
        }
      ];
      
      mockDependencies.pullRequestService.getNewComments.mockResolvedValue(comments);

      // 여러 핸들러 생성
      const handler1 = new ReviewTaskHandler(
        mockConfig,
        mockDependencies,
        mockWorkflowStateManager,
        mockErrorManager,
        mockLogger
      );
      
      const handler2 = new ReviewTaskHandler(
        mockConfig,
        mockDependencies,
        mockWorkflowStateManager,
        mockErrorManager,
        mockLogger
      );

      // When: 동시에 실행
      const [result1, result2] = await Promise.allSettled([
        handler1.handle(),
        handler2.handle()
      ]);

      // Then: 모두 성공적으로 완료되어야 함
      expect(result1.status).toBe('fulfilled');
      expect(result2.status).toBe('fulfilled');
    });
  });
});
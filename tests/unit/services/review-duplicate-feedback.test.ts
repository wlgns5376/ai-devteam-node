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

describe('리뷰 중복 피드백 방지 테스트', () => {
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

  describe('중복 피드백 방지 메커니즘', () => {
    it('이미 처리된 코멘트는 필터링되어야 한다', async () => {
      // Given: IN_REVIEW 상태의 작업과 PR
      const reviewItem = {
        id: 'task-1',
        title: 'Test Task',
        pullRequestUrls: ['https://github.com/owner/repo/pull/1']
      };
      
      mockDependencies.projectBoardService.getItems.mockResolvedValue([reviewItem]);
      
      // PR에 3개의 코멘트가 있음
      const allComments: PullRequestComment[] = [
        {
          id: 'comment-1',
          content: 'First feedback',
          author: 'reviewer1',
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'comment-2',
          content: 'Second feedback',
          author: 'reviewer2',
          createdAt: new Date('2024-01-01T11:00:00Z'),
        },
        {
          id: 'comment-3',
          content: 'Third feedback',
          author: 'reviewer1',
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }
      ];
      
      mockDependencies.pullRequestService.getNewComments.mockResolvedValue(allComments);
      
      // 이미 처리된 코멘트: comment-1, comment-2
      mockDependencies.stateManager.getProcessedCommentsForTask.mockResolvedValue(['comment-1', 'comment-2']);

      // When: 리뷰 작업을 처리하면
      await reviewTaskHandler.handle();

      // Then: 처리되지 않은 코멘트(comment-3)만 Manager에게 전달되어야 함
      expect(mockDependencies.managerCommunicator.sendTaskToManager).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-1',
          action: 'process_feedback',
          comments: [allComments[2]] // comment-3만
        })
      );
    });

    it('모든 코멘트가 이미 처리된 경우 피드백 처리를 요청하지 않아야 한다', async () => {
      // Given: IN_REVIEW 상태의 작업
      const reviewItem = {
        id: 'task-2',
        title: 'Test Task 2',
        pullRequestUrls: ['https://github.com/owner/repo/pull/2']
      };
      
      mockDependencies.projectBoardService.getItems.mockResolvedValue([reviewItem]);
      
      // PR에 2개의 코멘트가 있음
      const allComments: PullRequestComment[] = [
        {
          id: 'comment-a',
          content: 'Already processed feedback 1',
          author: 'reviewer1',
          createdAt: new Date('2024-01-02T10:00:00Z'),
        },
        {
          id: 'comment-b',
          content: 'Already processed feedback 2',
          author: 'reviewer2',
          createdAt: new Date('2024-01-02T11:00:00Z'),
        }
      ];
      
      mockDependencies.pullRequestService.getNewComments.mockResolvedValue(allComments);
      
      // 모든 코멘트가 이미 처리됨
      mockDependencies.stateManager.getProcessedCommentsForTask.mockResolvedValue(['comment-a', 'comment-b']);

      // When: 리뷰 작업을 처리하면
      await reviewTaskHandler.handle();

      // Then: Manager에게 피드백 처리를 요청하지 않아야 함
      expect(mockDependencies.managerCommunicator.sendTaskToManager).not.toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'process_feedback'
        })
      );
    });

    it('피드백 처리 성공 시 처리된 코멘트를 기록해야 한다', async () => {
      // Given: 새로운 피드백이 있는 작업
      const reviewItem = {
        id: 'task-3',
        title: 'Test Task 3',
        pullRequestUrls: ['https://github.com/owner/repo/pull/3']
      };
      
      mockDependencies.projectBoardService.getItems.mockResolvedValue([reviewItem]);
      
      const newComments: PullRequestComment[] = [
        {
          id: 'comment-new-1',
          content: 'New feedback to process',
          author: 'reviewer1',
          createdAt: new Date(),
        },
        {
          id: 'comment-new-2',
          content: 'Another new feedback',
          author: 'reviewer2',
          createdAt: new Date(),
        }
      ];
      
      mockDependencies.pullRequestService.getNewComments.mockResolvedValue(newComments);
      mockDependencies.stateManager.getProcessedCommentsForTask.mockResolvedValue([]);
      
      // Manager가 ACCEPTED 응답 반환
      mockDependencies.managerCommunicator.sendTaskToManager.mockResolvedValue({
        status: ResponseStatus.ACCEPTED,
        taskId: 'task-3'
      });

      // When: 리뷰 작업을 처리하면
      await reviewTaskHandler.handle();

      // Then: 처리된 코멘트가 StateManager에 기록되어야 함
      expect(mockDependencies.stateManager.addProcessedCommentsToTask).toHaveBeenCalledWith(
        'task-3',
        ['comment-new-1', 'comment-new-2']
      );
      
      // lastSyncTime도 업데이트되어야 함
      expect(mockDependencies.stateManager.updateTaskLastSyncTime).toHaveBeenCalledWith(
        'task-3',
        expect.any(Date)
      );
    });

    it('피드백 처리 완료(COMPLETED) 시에도 처리된 코멘트를 기록해야 한다', async () => {
      // Given: 피드백 처리가 완료되는 작업
      const reviewItem = {
        id: 'task-4',
        title: 'Test Task 4',
        pullRequestUrls: ['https://github.com/owner/repo/pull/4']
      };
      
      mockDependencies.projectBoardService.getItems.mockResolvedValue([reviewItem]);
      
      const newComments: PullRequestComment[] = [
        {
          id: 'comment-complete-1',
          content: 'Feedback that completes the task',
          author: 'reviewer1',
          createdAt: new Date(),
        }
      ];
      
      mockDependencies.pullRequestService.getNewComments.mockResolvedValue(newComments);
      mockDependencies.stateManager.getProcessedCommentsForTask.mockResolvedValue([]);
      
      // Manager가 COMPLETED 응답과 새 PR URL 반환
      mockDependencies.managerCommunicator.sendTaskToManager.mockResolvedValue({
        status: ResponseStatus.COMPLETED,
        taskId: 'task-4',
        pullRequestUrl: 'https://github.com/owner/repo/pull/5'
      });

      // When: 리뷰 작업을 처리하면
      await reviewTaskHandler.handle();

      // Then: 처리된 코멘트가 기록되어야 함
      expect(mockDependencies.stateManager.addProcessedCommentsToTask).toHaveBeenCalledWith(
        'task-4',
        ['comment-complete-1']
      );
      
      // 새 PR URL이 추가되어야 함
      expect(mockDependencies.projectBoardService.addPullRequestToItem).toHaveBeenCalledWith(
        'task-4',
        'https://github.com/owner/repo/pull/5'
      );
    });

    it('lastSyncTime과 processedCommentIds를 함께 사용하여 이중 필터링해야 한다', async () => {
      // Given: lastSyncTime 이전과 이후의 코멘트가 섞여 있는 상황
      const reviewItem = {
        id: 'task-5',
        title: 'Test Task 5',
        pullRequestUrls: ['https://github.com/owner/repo/pull/5']
      };
      
      mockDependencies.projectBoardService.getItems.mockResolvedValue([reviewItem]);
      
      const lastSyncTime = new Date('2024-01-03T10:00:00Z');
      mockDependencies.stateManager.getTaskLastSyncTime.mockResolvedValue(lastSyncTime);
      
      // getNewComments는 lastSyncTime 이후의 코멘트만 반환
      const recentComments: PullRequestComment[] = [
        {
          id: 'recent-1',
          content: 'Recent comment 1',
          author: 'reviewer1',
          createdAt: new Date('2024-01-03T11:00:00Z'),
        },
        {
          id: 'recent-2',
          content: 'Recent comment 2',
          author: 'reviewer2',
          createdAt: new Date('2024-01-03T12:00:00Z'),
        },
        {
          id: 'recent-3',
          content: 'Recent comment 3',
          author: 'reviewer3',
          createdAt: new Date('2024-01-03T13:00:00Z'),
        }
      ];
      
      mockDependencies.pullRequestService.getNewComments.mockResolvedValue(recentComments);
      
      // recent-1은 이미 처리됨 (예: 이전 실행에서 처리됐지만 lastSyncTime 업데이트 실패)
      mockDependencies.stateManager.getProcessedCommentsForTask.mockResolvedValue(['recent-1']);

      // When: 리뷰 작업을 처리하면
      await reviewTaskHandler.handle();

      // Then: 시간상 새롭고 처리되지 않은 코멘트만 전달되어야 함
      expect(mockDependencies.managerCommunicator.sendTaskToManager).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-5',
          action: 'process_feedback',
          comments: [recentComments[1], recentComments[2]] // recent-2, recent-3만
        })
      );
    });
  });

  describe('동시 실행 시나리오', () => {
    it('동일한 피드백이 짧은 시간 간격으로 처리 요청되어도 중복 처리되지 않아야 한다', async () => {
      // Given: 리뷰 작업
      const reviewItem = {
        id: 'task-concurrent',
        title: 'Concurrent Test Task',
        pullRequestUrls: ['https://github.com/owner/repo/pull/10']
      };
      
      mockDependencies.projectBoardService.getItems.mockResolvedValue([reviewItem]);
      
      const comments: PullRequestComment[] = [
        {
          id: 'concurrent-comment',
          content: 'Comment that might be processed twice',
          author: 'reviewer1',
          createdAt: new Date(),
        }
      ];
      
      // 첫 번째 실행
      mockDependencies.pullRequestService.getNewComments.mockResolvedValue(comments);
      mockDependencies.stateManager.getProcessedCommentsForTask.mockResolvedValue([]);
      
      await reviewTaskHandler.handle();
      
      // 처리된 코멘트가 기록됨
      expect(mockDependencies.stateManager.addProcessedCommentsToTask).toHaveBeenCalledWith(
        'task-concurrent',
        ['concurrent-comment']
      );
      
      // 두 번째 실행 (처리된 코멘트 반영)
      mockDependencies.stateManager.getProcessedCommentsForTask.mockResolvedValue(['concurrent-comment']);
      mockDependencies.managerCommunicator.sendTaskToManager.mockClear();
      
      await reviewTaskHandler.handle();
      
      // Then: 두 번째 실행에서는 피드백 처리를 요청하지 않아야 함
      expect(mockDependencies.managerCommunicator.sendTaskToManager).not.toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'process_feedback'
        })
      );
    });
  });
});
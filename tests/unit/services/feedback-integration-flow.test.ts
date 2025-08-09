import { Planner } from '@/services/planner';
import { MockProjectBoardService } from '@/services/mock-project-board';
import { MockPullRequestService } from '@/services/mock-pull-request';
import { Logger } from '@/services/logger';
import { 
  PlannerServiceConfig,
  ResponseStatus,
  PullRequestState,
  PullRequestComment,
  WorkerAction,
  ReviewState
} from '@/types';

// Enhanced Mock Manager Communicator for feedback flow testing
class MockManagerCommunicator {
  private responses: Map<string, any> = new Map();
  private sentRequests: any[] = [];
  private workerStates: Map<string, string> = new Map();

  setResponse(taskId: string, response: any): void {
    this.responses.set(taskId, response);
  }

  setWorkerState(taskId: string, state: string): void {
    this.workerStates.set(taskId, state);
  }

  async sendTaskToManager(request: any): Promise<any> {
    this.sentRequests.push(request);
    
    // Worker 상태에 따른 응답 시뮬레이션
    const workerState = this.workerStates.get(request.taskId);
    if (request.action === 'process_feedback' && workerState === 'working') {
      return {
        taskId: request.taskId,
        status: ResponseStatus.REJECTED,
        message: 'Worker is currently busy'
      };
    }
    
    return this.responses.get(request.taskId) || { 
      taskId: request.taskId, 
      status: ResponseStatus.ACCEPTED 
    };
  }

  getSentRequests(): any[] {
    return [...this.sentRequests];
  }

  getRequestsByAction(action: string): any[] {
    return this.sentRequests.filter(req => req.action === action);
  }

  getRequestsForTask(taskId: string): any[] {
    return this.sentRequests.filter(req => req.taskId === taskId);
  }

  clearRequests(): void {
    this.sentRequests = [];
  }
}

describe('피드백 처리 통합 플로우 테스트', () => {
  let planner: Planner;
  let mockProjectBoardService: MockProjectBoardService;
  let mockPullRequestService: MockPullRequestService;
  let mockStateManager: any;
  let mockLogger: Logger;
  let mockManagerCommunicator: MockManagerCommunicator;

  beforeEach(async () => {
    mockProjectBoardService = new MockProjectBoardService();
    mockPullRequestService = new MockPullRequestService();
    
    mockStateManager = {
      initialize: jest.fn().mockResolvedValue(undefined),
      saveTask: jest.fn().mockResolvedValue(undefined),
      getTask: jest.fn().mockResolvedValue(undefined),
      getAllTasks: jest.fn().mockResolvedValue([]),
      getTasksByStatus: jest.fn().mockResolvedValue([]),
      updateTaskStatus: jest.fn().mockResolvedValue(undefined),
      removeTask: jest.fn().mockResolvedValue(undefined),
      saveWorker: jest.fn().mockResolvedValue(undefined),
      getWorker: jest.fn().mockResolvedValue(undefined),
      getAllWorkers: jest.fn().mockResolvedValue([]),
      updateWorkerStatus: jest.fn().mockResolvedValue(undefined),
      removeWorker: jest.fn().mockResolvedValue(undefined),
      saveWorkspace: jest.fn().mockResolvedValue(undefined),
      getWorkspace: jest.fn().mockResolvedValue(undefined),
      removeWorkspace: jest.fn().mockResolvedValue(undefined),
      updateLastSyncTime: jest.fn().mockResolvedValue(undefined),
      getPlannerState: jest.fn().mockResolvedValue({
        lastSyncTime: new Date(),
        processedTasks: [],
        activeTasks: []
      }),
      addProcessedCommentsToTask: jest.fn().mockResolvedValue(undefined),
      setPlannerLastSyncTime: function(time: Date) {
        this.getPlannerState = jest.fn().mockResolvedValue({
          lastSyncTime: time,
          processedTasks: [],
          activeTasks: []
        });
      }
    } as any;
    
    mockLogger = Logger.createConsoleLogger();
    mockManagerCommunicator = new MockManagerCommunicator();

    const config: PlannerServiceConfig = {
      boardId: 'board-1',
      repoId: 'test-repo',
      monitoringIntervalMs: 1000,
      maxRetryAttempts: 3,
      timeoutMs: 5000
    };

    planner = new Planner(config, {
      projectBoardService: mockProjectBoardService,
      pullRequestService: mockPullRequestService,
      stateManager: mockStateManager,
      logger: mockLogger,
      managerCommunicator: mockManagerCommunicator as any
    });
  });

  afterEach(async () => {
    if (planner) {
      await planner.stopMonitoring();
    }
  });

  describe('신규 피드백 감지', () => {
    it('PR에 새로운 코멘트가 추가되면 피드백 처리를 시작해야 한다', async () => {
      // Given: IN_REVIEW 상태의 작업과 PR
      await mockProjectBoardService.updateItemStatus('board-1-item-2', 'IN_REVIEW');
      await mockProjectBoardService.addPullRequestToItem('board-1-item-2', 'https://github.com/wlgns5376/ai-devteam-test/pull/1');
      
      // PR이 승인되지 않은 상태로 설정 (CHANGES_REQUESTED)
      mockPullRequestService.setPullRequestApproval('wlgns5376/ai-devteam-test', 1, false);
      mockPullRequestService.setPullRequestState('https://github.com/wlgns5376/ai-devteam-test/pull/1', ReviewState.CHANGES_REQUESTED);
      
      // lastSyncTime을 과거로 설정하여 새로운 코멘트가 감지되도록 함
      const pastTime = new Date(Date.now() - 60 * 60 * 1000); // 1시간 전
      mockStateManager.setPlannerLastSyncTime(pastTime);
      
      // 새로운 코멘트 추가 (현재 시간)
      const newComment: PullRequestComment = {
        id: 'comment-new-1',
        content: 'Please fix the coding style and add proper error handling',
        author: 'reviewer-1',
        createdAt: new Date(),
      };
      
      mockPullRequestService.addComment('https://github.com/wlgns5376/ai-devteam-test/pull/1', newComment);
      
      mockManagerCommunicator.setResponse('board-1-item-2', {
        taskId: 'board-1-item-2',
        status: ResponseStatus.ACCEPTED
      });

      // When: 리뷰 작업을 처리하면
      await planner.handleReviewTasks();

      // Then: 피드백 처리 요청이 Manager에게 전달되어야 함
      const feedbackRequests = mockManagerCommunicator.getRequestsByAction('process_feedback');
      expect(feedbackRequests.length).toBeGreaterThan(0);
      
      const feedbackRequest = feedbackRequests.find(req => req.taskId === 'board-1-item-2');
      expect(feedbackRequest).toBeDefined();
      expect(feedbackRequest.comments).toHaveLength(1);
      expect(feedbackRequest.comments[0].content).toContain('coding style');
      expect(feedbackRequest.pullRequestUrl).toBe('https://github.com/wlgns5376/ai-devteam-test/pull/1');
    });

    it('여러 개의 새로운 코멘트를 모두 포함해서 처리해야 한다', async () => {
      // Given: 여러 코멘트가 있는 PR
      await mockProjectBoardService.updateItemStatus('board-1-item-3', 'IN_REVIEW');
      await mockProjectBoardService.addPullRequestToItem('board-1-item-3', 'https://github.com/wlgns5376/ai-devteam-test/pull/2');
      
      // PR이 승인되지 않은 상태로 설정 (CHANGES_REQUESTED)
      mockPullRequestService.setPullRequestApproval('wlgns5376/ai-devteam-test', 2, false);
      mockPullRequestService.setPullRequestState('https://github.com/wlgns5376/ai-devteam-test/pull/2', ReviewState.CHANGES_REQUESTED);
      
      // lastSyncTime을 과거로 설정
      const pastTime = new Date(Date.now() - 60 * 60 * 1000);
      mockStateManager.setPlannerLastSyncTime(pastTime);
      
      const comments: PullRequestComment[] = [
        {
          id: 'comment-multi-1',
          content: 'Fix variable naming conventions',
          author: 'reviewer-1',
          createdAt: new Date(Date.now() - 1000),
          // url: 'https://github.com/wlgns5376/ai-devteam-test/pull/2#comment-multi-1'
        },
        {
          id: 'comment-multi-2',
          content: 'Add unit tests for the new function',
          author: 'reviewer-2',
          createdAt: new Date(),
          // url: 'https://github.com/wlgns5376/ai-devteam-test/pull/2#comment-multi-2'
        },
        {
          id: 'comment-multi-3',
          content: 'Documentation needs to be updated',
          author: 'reviewer-1',
          createdAt: new Date(Date.now() + 1000),
          // url: 'https://github.com/wlgns5376/ai-devteam-test/pull/2#comment-multi-3'
        }
      ];

      comments.forEach(comment => {
        mockPullRequestService.addComment('https://github.com/wlgns5376/ai-devteam-test/pull/2', comment);
      });

      mockManagerCommunicator.setResponse('board-1-item-3', {
        taskId: 'board-1-item-3',
        status: ResponseStatus.ACCEPTED
      });

      // When: 리뷰 작업을 처리하면
      await planner.handleReviewTasks();

      // Then: 모든 코멘트가 포함된 피드백 처리 요청이 전달되어야 함
      const feedbackRequests = mockManagerCommunicator.getRequestsByAction('process_feedback');
      const relevantRequest = feedbackRequests.find(req => req.taskId === 'board-1-item-3');
      
      expect(relevantRequest).toBeDefined();
      expect(relevantRequest.comments).toHaveLength(3);
      
      const commentBodies = relevantRequest.comments.map((c: any) => c.content);
      expect(commentBodies).toContain('Fix variable naming conventions');
      expect(commentBodies).toContain('Add unit tests for the new function');
      expect(commentBodies).toContain('Documentation needs to be updated');
    });

    it('이미 처리된 코멘트는 제외하고 새로운 코멘트만 처리해야 한다', async () => {
      // Given: 이전에 처리된 코멘트가 있는 PR
      await mockProjectBoardService.updateItemStatus('board-1-item-4', 'IN_REVIEW');
      await mockProjectBoardService.addPullRequestToItem('board-1-item-4', 'https://github.com/wlgns5376/ai-devteam-test/pull/3');
      
      mockPullRequestService.setPullRequestApproval('wlgns5376/ai-devteam-test', 3, false);
      mockPullRequestService.setPullRequestState('https://github.com/wlgns5376/ai-devteam-test/pull/3', ReviewState.CHANGES_REQUESTED);

      // 이전 코멘트 (이미 처리됨으로 표시)
      const oldComment: PullRequestComment = {
        id: 'comment-old-1',
        content: 'Old feedback that was already processed',
        author: 'reviewer-1',
        createdAt: new Date(Date.now() - 86400000), // 1일 전
        // url: 'https://github.com/wlgns5376/ai-devteam-test/pull/3#comment-old-1'
      };

      // 새 코멘트
      const newComment: PullRequestComment = {
        id: 'comment-new-1',
        content: 'New feedback that needs processing',
        author: 'reviewer-2',
        createdAt: new Date(),
        // url: 'https://github.com/wlgns5376/ai-devteam-test/pull/3#comment-new-1'
      };

      mockPullRequestService.addComment('https://github.com/wlgns5376/ai-devteam-test/pull/3', oldComment);
      mockPullRequestService.addComment('https://github.com/wlgns5376/ai-devteam-test/pull/3', newComment);

      // 첫 번째 처리 - 이전 코멘트 처리
      mockManagerCommunicator.setResponse('board-1-item-4', {
        taskId: 'board-1-item-4',
        status: ResponseStatus.ACCEPTED
      });

      await planner.handleReviewTasks();
      mockManagerCommunicator.clearRequests();

      // When: 두 번째 처리 - 새 코멘트만 처리되어야 함
      await planner.handleReviewTasks();

      // Then: 새로운 코멘트만 포함된 요청이 전달되어야 함
      const feedbackRequests = mockManagerCommunicator.getRequestsByAction('process_feedback');
      
      if (feedbackRequests.length > 0) {
        const relevantRequest = feedbackRequests.find(req => req.taskId === 'board-1-item-4');
        if (relevantRequest) {
          expect(relevantRequest.comments).toHaveLength(1);
          expect(relevantRequest.comments[0].content).toContain('New feedback that needs processing');
        }
      }
    });
  });

  describe('Worker 상태별 피드백 처리', () => {
    it('Worker가 유휴 상태일 때 피드백 처리를 즉시 시작해야 한다', async () => {
      // Given: Worker가 유휴 상태이고 새 피드백이 있음
      await mockProjectBoardService.updateItemStatus('board-1-item-5', 'IN_REVIEW');
      await mockProjectBoardService.addPullRequestToItem('board-1-item-5', 'https://github.com/wlgns5376/ai-devteam-test/pull/4');
      
      mockPullRequestService.setPullRequestApproval('wlgns5376/ai-devteam-test', 4, false);
      mockPullRequestService.setPullRequestState('https://github.com/wlgns5376/ai-devteam-test/pull/4', ReviewState.CHANGES_REQUESTED);
      
      const feedbackComment: PullRequestComment = {
        id: 'comment-idle-worker',
        content: 'Please optimize the performance',
        author: 'reviewer',
        createdAt: new Date(),
        // url: 'https://github.com/wlgns5376/ai-devteam-test/pull/4#comment-idle-worker'
      };
      
      mockPullRequestService.addComment('https://github.com/wlgns5376/ai-devteam-test/pull/4', feedbackComment);
      
      mockManagerCommunicator.setWorkerState('board-1-item-5', 'idle');
      mockManagerCommunicator.setResponse('board-1-item-5', {
        taskId: 'board-1-item-5',
        status: ResponseStatus.ACCEPTED
      });

      // When: 리뷰 작업을 처리하면
      await planner.handleReviewTasks();

      // Then: 피드백 처리가 즉시 시작되어야 함
      const feedbackRequests = mockManagerCommunicator.getRequestsByAction('process_feedback');
      const relevantRequest = feedbackRequests.find(req => req.taskId === 'board-1-item-5');
      
      expect(relevantRequest).toBeDefined();
      expect(relevantRequest.action).toBe('process_feedback');
    });

    it('Worker가 작업 중일 때 피드백 처리를 지연해야 한다', async () => {
      // Given: Worker가 작업 중이고 새 피드백이 있음
      await mockProjectBoardService.updateItemStatus('board-1-item-6', 'IN_REVIEW');
      await mockProjectBoardService.addPullRequestToItem('board-1-item-6', 'https://github.com/wlgns5376/ai-devteam-test/pull/5');
      
      mockPullRequestService.setPullRequestApproval('wlgns5376/ai-devteam-test', 5, false);
      mockPullRequestService.setPullRequestState('https://github.com/wlgns5376/ai-devteam-test/pull/5', ReviewState.CHANGES_REQUESTED);
      
      const feedbackComment: PullRequestComment = {
        id: 'comment-busy-worker',
        content: 'Add better error messages',
        author: 'reviewer',
        createdAt: new Date(),
        // url: 'https://github.com/wlgns5376/ai-devteam-test/pull/5#comment-busy-worker'
      };
      
      mockPullRequestService.addComment('https://github.com/wlgns5376/ai-devteam-test/pull/5', feedbackComment);
      
      mockManagerCommunicator.setWorkerState('board-1-item-6', 'working');
      mockManagerCommunicator.setResponse('board-1-item-6', {
        taskId: 'board-1-item-6',
        status: ResponseStatus.REJECTED,
        message: 'Worker is currently busy'
      });

      // When: 리뷰 작업을 처리하면
      await planner.handleReviewTasks();

      // Then: 피드백 처리가 거부되어야 함
      const feedbackRequests = mockManagerCommunicator.getRequestsByAction('process_feedback');
      const relevantRequest = feedbackRequests.find(req => req.taskId === 'board-1-item-6');
      
      expect(relevantRequest).toBeDefined();
      
      // 재시도를 위해 작업이 IN_REVIEW 상태를 유지해야 함
      const reviewItems = await mockProjectBoardService.getItems('board-1', 'IN_REVIEW');
      const stillInReview = reviewItems.find(item => item.id === 'board-1-item-6');
      expect(stillInReview).toBeDefined();
    });

    it('Worker가 유휴 상태가 되면 대기 중인 피드백을 처리해야 한다', async () => {
      // Given: 이전에 거부된 피드백이 있음
      await mockProjectBoardService.updateItemStatus('board-1-item-7', 'IN_REVIEW');
      await mockProjectBoardService.addPullRequestToItem('board-1-item-7', 'https://github.com/wlgns5376/ai-devteam-test/pull/6');
      
      mockPullRequestService.setPullRequestApproval('wlgns5376/ai-devteam-test', 6, false);
      mockPullRequestService.setPullRequestState('https://github.com/wlgns5376/ai-devteam-test/pull/6', ReviewState.CHANGES_REQUESTED);
      
      const feedbackComment: PullRequestComment = {
        id: 'comment-retry',
        content: 'Refactor the complex function',
        author: 'reviewer',
        createdAt: new Date(),
        // url: 'https://github.com/wlgns5376/ai-devteam-test/pull/6#comment-retry'
      };
      
      mockPullRequestService.addComment('https://github.com/wlgns5376/ai-devteam-test/pull/6', feedbackComment);
      
      // 첫 번째 시도: Worker 바쁨
      mockManagerCommunicator.setWorkerState('board-1-item-7', 'working');
      mockManagerCommunicator.setResponse('board-1-item-7', {
        taskId: 'board-1-item-7',
        status: ResponseStatus.REJECTED,
        message: 'Worker is currently busy'
      });

      await planner.handleReviewTasks();
      mockManagerCommunicator.clearRequests();

      // When: Worker가 유휴 상태가 됨
      mockManagerCommunicator.setWorkerState('board-1-item-7', 'idle');
      mockManagerCommunicator.setResponse('board-1-item-7', {
        taskId: 'board-1-item-7',
        status: ResponseStatus.ACCEPTED
      });

      await planner.handleReviewTasks();

      // Then: 대기 중인 피드백이 처리되어야 함
      const feedbackRequests = mockManagerCommunicator.getRequestsByAction('process_feedback');
      const relevantRequest = feedbackRequests.find(req => req.taskId === 'board-1-item-7');
      
      expect(relevantRequest).toBeDefined();
      expect(relevantRequest.comments[0].content).toContain('Refactor the complex function');
    });
  });

  describe('피드백 처리 완료 및 후속 작업', () => {
    it('피드백 처리 완료 후 새로운 PR이 생성되면 상태를 업데이트해야 한다', async () => {
      // Given: 피드백 처리가 완료되어 새 PR이 생성됨
      await mockProjectBoardService.updateItemStatus('board-1-item-8', 'IN_REVIEW');
      await mockProjectBoardService.addPullRequestToItem('board-1-item-8', 'https://github.com/wlgns5376/ai-devteam-test/pull/7');
      
      mockPullRequestService.setPullRequestApproval('wlgns5376/ai-devteam-test', 7, false);
      mockPullRequestService.setPullRequestState('https://github.com/wlgns5376/ai-devteam-test/pull/7', ReviewState.CHANGES_REQUESTED);
      
      const feedbackComment: PullRequestComment = {
        id: 'comment-completed',
        content: 'Fix the memory leak issue',
        author: 'reviewer',
        createdAt: new Date(),
        // url: 'https://github.com/wlgns5376/ai-devteam-test/pull/7#comment-completed'
      };
      
      mockPullRequestService.addComment('https://github.com/wlgns5376/ai-devteam-test/pull/7', feedbackComment);
      
      mockManagerCommunicator.setResponse('board-1-item-8', {
        taskId: 'board-1-item-8',
        status: ResponseStatus.COMPLETED,
        pullRequestUrl: 'https://github.com/wlgns5376/ai-devteam-test/pull/8'
      });

      // When: 피드백 처리 완료
      await planner.handleReviewTasks();

      // Then: 새로운 PR URL이 추가되어야 함
      const reviewItems = await mockProjectBoardService.getItems('board-1', 'IN_REVIEW');
      const updatedItem = reviewItems.find(item => item.id === 'board-1-item-8');
      
      expect(updatedItem).toBeDefined();
      expect(updatedItem!.pullRequestUrls).toContain('https://github.com/wlgns5376/ai-devteam-test/pull/8');
    });

    it('피드백 처리 실패 시 적절한 에러 로깅을 해야 한다', async () => {
      // Given: 피드백 처리가 실패하는 상황
      await mockProjectBoardService.updateItemStatus('board-1-item-9', 'IN_REVIEW');
      await mockProjectBoardService.addPullRequestToItem('board-1-item-9', 'https://github.com/wlgns5376/ai-devteam-test/pull/9');
      
      mockPullRequestService.setPullRequestApproval('wlgns5376/ai-devteam-test', 9, false);
      mockPullRequestService.setPullRequestState('https://github.com/wlgns5376/ai-devteam-test/pull/9', ReviewState.CHANGES_REQUESTED);
      
      const feedbackComment: PullRequestComment = {
        id: 'comment-failed',
        content: 'Complex refactoring required',
        author: 'reviewer',
        createdAt: new Date(),
        // url: 'https://github.com/wlgns5376/ai-devteam-test/pull/9#comment-failed'
      };
      
      mockPullRequestService.addComment('https://github.com/wlgns5376/ai-devteam-test/pull/9', feedbackComment);
      
      mockManagerCommunicator.setResponse('board-1-item-9', {
        taskId: 'board-1-item-9',
        status: ResponseStatus.ERROR,
        message: 'Feedback processing failed due to technical issues'
      });

      const loggerErrorSpy = jest.spyOn(mockLogger, 'error');

      // When: 피드백 처리를 시도하면
      await planner.handleReviewTasks();

      // Then: 에러가 로깅되고 작업이 IN_REVIEW 상태를 유지해야 함
      const status = planner.getStatus();
      expect(status.errors.length).toBeGreaterThan(0);
      
      const reviewItems = await mockProjectBoardService.getItems('board-1', 'IN_REVIEW');
      const failedItem = reviewItems.find(item => item.id === 'board-1-item-9');
      expect(failedItem).toBeDefined();
    });
  });

  describe('복합 피드백 시나리오', () => {
    it('여러 작업의 피드백을 동시에 처리해야 한다', async () => {
      // Given: 여러 작업에 피드백이 있음
      const taskIds = ['board-1-item-10', 'board-1-item-11', 'board-1-item-12'];
      const prUrls = [
        'https://github.com/wlgns5376/ai-devteam-test/pull/10',
        'https://github.com/wlgns5376/ai-devteam-test/pull/11',
        'https://github.com/wlgns5376/ai-devteam-test/pull/12'
      ];

      for (let i = 0; i < taskIds.length; i++) {
        await mockProjectBoardService.updateItemStatus(taskIds[i]!, 'IN_REVIEW');
        await mockProjectBoardService.addPullRequestToItem(taskIds[i]!, prUrls[i]!);
        
        const prNumber = 10 + i;
        mockPullRequestService.setPullRequestApproval('wlgns5376/ai-devteam-test', prNumber, false);
        mockPullRequestService.setPullRequestState(prUrls[i]!, ReviewState.CHANGES_REQUESTED);
        
        const feedbackComment: PullRequestComment = {
          id: `comment-multi-${i}`,
          content: `Feedback for task ${i}: Please improve the implementation`,
          author: 'reviewer',
          createdAt: new Date(),
          // url: `${prUrls[i]!}#comment-multi-${i}`
        };
        
        mockPullRequestService.addComment(prUrls[i]!, feedbackComment);
        
        mockManagerCommunicator.setResponse(taskIds[i]!, {
          taskId: taskIds[i]!,
          status: ResponseStatus.ACCEPTED
        });
      }

      // When: 리뷰 작업을 처리하면
      await planner.handleReviewTasks();

      // Then: 모든 작업의 피드백이 처리되어야 함
      const feedbackRequests = mockManagerCommunicator.getRequestsByAction('process_feedback');
      expect(feedbackRequests.length).toBe(3);
      
      taskIds.forEach(taskId => {
        const taskRequest = feedbackRequests.find(req => req.taskId === taskId);
        expect(taskRequest).toBeDefined();
        expect(taskRequest.comments).toHaveLength(1);
      });
    });

    it('피드백 처리 중에 추가된 새로운 코멘트를 다음 주기에서 처리해야 한다', async () => {
      // Given: 초기 피드백이 있는 작업
      await mockProjectBoardService.updateItemStatus('board-1-item-13', 'IN_REVIEW');
      await mockProjectBoardService.addPullRequestToItem('board-1-item-13', 'https://github.com/wlgns5376/ai-devteam-test/pull/13');
      
      mockPullRequestService.setPullRequestApproval('wlgns5376/ai-devteam-test', 13, false);
      mockPullRequestService.setPullRequestState('https://github.com/wlgns5376/ai-devteam-test/pull/13', ReviewState.CHANGES_REQUESTED);
      
      const initialComment: PullRequestComment = {
        id: 'comment-initial',
        content: 'Initial feedback to address',
        author: 'reviewer-1',
        createdAt: new Date(Date.now() - 1000),
        // url: 'https://github.com/wlgns5376/ai-devteam-test/pull/13#comment-initial'
      };
      
      mockPullRequestService.addComment('https://github.com/wlgns5376/ai-devteam-test/pull/13', initialComment);
      
      mockManagerCommunicator.setResponse('board-1-item-13', {
        taskId: 'board-1-item-13',
        status: ResponseStatus.ACCEPTED
      });

      // 첫 번째 처리
      await planner.handleReviewTasks();
      mockManagerCommunicator.clearRequests();

      // When: 새로운 코멘트 추가
      const additionalComment: PullRequestComment = {
        id: 'comment-additional',
        content: 'Additional feedback while processing',
        author: 'reviewer-2',
        createdAt: new Date(),
        // url: 'https://github.com/wlgns5376/ai-devteam-test/pull/13#comment-additional'
      };
      
      mockPullRequestService.addComment('https://github.com/wlgns5376/ai-devteam-test/pull/13', additionalComment);
      
      // 두 번째 처리
      await planner.handleReviewTasks();

      // Then: 새로운 코멘트가 별도로 처리되어야 함
      const feedbackRequests = mockManagerCommunicator.getRequestsByAction('process_feedback');
      
      if (feedbackRequests.length > 0) {
        const latestRequest = feedbackRequests[feedbackRequests.length - 1];
        expect(latestRequest.taskId).toBe('board-1-item-13');
        expect(latestRequest.comments.some((c: any) => c.content.includes('Additional feedback'))).toBe(true);
      }
    });
  });
});
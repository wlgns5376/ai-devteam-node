import { Planner } from '@/services/planner';
import { MockProjectBoardService } from '@/services/mock-project-board';
import { MockPullRequestService } from '@/services/mock-pull-request';
import { Logger } from '@/services/logger';
import { 
  PlannerServiceConfig,
  ResponseStatus,
  PullRequestState,
  WorkerAction,
  ReviewState
} from '@/types';

// Mock Manager Communicator for PR merge testing
class MockManagerCommunicator {
  private responses: Map<string, any> = new Map();
  private sentRequests: any[] = [];

  setResponse(taskId: string, response: any): void {
    this.responses.set(taskId, response);
  }

  async sendTaskToManager(request: any): Promise<any> {
    this.sentRequests.push(request);
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

  clearRequests(): void {
    this.sentRequests = [];
  }
}

describe('PR 승인 후 병합 시나리오', () => {
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
        lastSyncTime: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24시간 전
        processedTasks: [],
        activeTasks: []
      }),
      addProcessedCommentsToTask: jest.fn().mockResolvedValue(undefined)
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

  describe('PR 승인 감지 및 병합 요청', () => {
    it('PR이 승인되면 병합 요청을 Manager에게 전달해야 한다', async () => {
      // Given: IN_REVIEW 상태의 작업과 승인된 PR이 있음
      await mockProjectBoardService.updateItemStatus('board-1-item-2', 'IN_REVIEW');
      // 기존 PR URL을 제거하고 테스트용 PR URL만 설정
      await mockProjectBoardService.setPullRequestToItem('board-1-item-2', 'https://github.com/wlgns5376/ai-devteam-test/pull/1');
      
      // PR이 승인된 상태로 설정
      mockPullRequestService.setPullRequestState('https://github.com/wlgns5376/ai-devteam-test/pull/1', ReviewState.APPROVED);
      
      mockManagerCommunicator.setResponse('board-1-item-2', {
        taskId: 'board-1-item-2',
        status: ResponseStatus.ACCEPTED
      });

      // When: 리뷰 작업을 처리하면
      await planner.handleReviewTasks();

      // Then: 병합 요청이 Manager에게 전달되어야 함
      const mergeRequests = mockManagerCommunicator.getRequestsByAction('request_merge');
      expect(mergeRequests.length).toBeGreaterThan(0);
      
      const mergeRequest = mergeRequests[0];
      expect(mergeRequest.taskId).toBe('board-1-item-2');
      expect(mergeRequest.pullRequestUrl).toBe('https://github.com/wlgns5376/ai-devteam-test/pull/1');
      expect(mergeRequest.action).toBe('request_merge');
    });

    it('병합 성공 시 작업 상태를 DONE으로 변경해야 한다', async () => {
      // Given: 병합 요청이 성공적으로 처리됨
      await mockProjectBoardService.updateItemStatus('board-1-item-3', 'IN_REVIEW');
      await mockProjectBoardService.setPullRequestToItem('board-1-item-3', 'https://github.com/wlgns5376/ai-devteam-test/pull/2');
      
      mockPullRequestService.setPullRequestState('https://github.com/wlgns5376/ai-devteam-test/pull/2', ReviewState.APPROVED);
      
      mockManagerCommunicator.setResponse('board-1-item-3', {
        taskId: 'board-1-item-3',
        status: ResponseStatus.COMPLETED,
        message: 'merged'
      });

      // When: 리뷰 작업을 처리하면
      await planner.handleReviewTasks();

      // Then: 작업이 DONE 상태로 변경되어야 함
      const doneItems = await mockProjectBoardService.getItems('board-1', 'DONE');
      const mergedTask = doneItems.find(item => item.id === 'board-1-item-3');
      expect(mergedTask).toBeDefined();
    });

    it('병합 실패 시 작업을 IN_REVIEW 상태로 유지해야 한다', async () => {
      // Given: 병합 요청이 실패함
      await mockProjectBoardService.updateItemStatus('board-1-item-4', 'IN_REVIEW');
      await mockProjectBoardService.setPullRequestToItem('board-1-item-4', 'https://github.com/wlgns5376/ai-devteam-test/pull/3');
      
      mockPullRequestService.setPullRequestState('https://github.com/wlgns5376/ai-devteam-test/pull/3', ReviewState.APPROVED);
      
      mockManagerCommunicator.setResponse('board-1-item-4', {
        taskId: 'board-1-item-4',
        status: ResponseStatus.ERROR,
        message: 'Merge conflicts detected'
      });

      // When: 리뷰 작업을 처리하면
      await planner.handleReviewTasks();

      // Then: 작업이 IN_REVIEW 상태를 유지하고 에러가 기록되어야 함
      const reviewItems = await mockProjectBoardService.getItems('board-1', 'IN_REVIEW');
      const failedTask = reviewItems.find(item => item.id === 'board-1-item-4');
      expect(failedTask).toBeDefined();

      const status = planner.getStatus();
      expect(status.errors.length).toBeGreaterThan(0);
      expect(status.errors[0]?.message).toContain('Merge conflicts detected');
    });
  });

  describe('병합 조건 검증', () => {
    it('PR이 승인되지 않은 경우 병합 요청을 하지 않아야 한다', async () => {
      // Given: IN_REVIEW 상태이지만 PR이 승인되지 않음
      await mockProjectBoardService.updateItemStatus('board-1-item-5', 'IN_REVIEW');
      await mockProjectBoardService.addPullRequestToItem('board-1-item-5', 'https://github.com/wlgns5376/ai-devteam-test/pull/4');
      
      // PR이 승인되지 않은 상태
      mockPullRequestService.setPullRequestApproval('wlgns5376/ai-devteam-test', 4, false);

      // When: 리뷰 작업을 처리하면
      await planner.handleReviewTasks();

      // Then: 병합 요청이 전달되지 않아야 함
      const mergeRequests = mockManagerCommunicator.getRequestsByAction('request_merge');
      const relevantRequest = mergeRequests.find(req => req.taskId === 'board-1-item-5');
      expect(relevantRequest).toBeUndefined();
    });

    it('PR이 이미 병합된 경우 작업 상태를 DONE으로 변경해야 한다', async () => {
      // Given: PR이 이미 병합된 상태
      await mockProjectBoardService.updateItemStatus('board-1-item-6', 'IN_REVIEW');
      await mockProjectBoardService.addPullRequestToItem('board-1-item-6', 'https://github.com/wlgns5376/ai-devteam-test/pull/5');
      
      // PR이 병합된 상태로 설정
      await mockPullRequestService.setPullRequestToMerged('https://github.com/wlgns5376/ai-devteam-test/pull/5');

      // When: 리뷰 작업을 처리하면
      await planner.handleReviewTasks();

      // Then: 작업이 자동으로 DONE 상태로 변경되어야 함
      const doneItems = await mockProjectBoardService.getItems('board-1', 'DONE');
      const autoMergedTask = doneItems.find(item => item.id === 'board-1-item-6');
      expect(autoMergedTask).toBeDefined();
    });

    it('PR이 거부된 경우 피드백 처리로 전환해야 한다', async () => {
      // Given: PR이 거부된 상태
      await mockProjectBoardService.updateItemStatus('board-1-item-7', 'IN_REVIEW');
      await mockProjectBoardService.addPullRequestToItem('board-1-item-7', 'https://github.com/wlgns5376/ai-devteam-test/pull/6');
      
      mockPullRequestService.setPullRequestState('https://github.com/wlgns5376/ai-devteam-test/pull/6', ReviewState.CHANGES_REQUESTED);
      
      // 새로운 코멘트 추가 (최근 시간으로 설정해야 newComments에 포함됨)
      await mockPullRequestService.addComment('https://github.com/wlgns5376/ai-devteam-test/pull/6', {
        id: 'comment-1',
        content: 'Please fix the code style issues',
        author: 'reviewer',
        createdAt: new Date() // 현재 시간으로 설정
      });

      mockManagerCommunicator.setResponse('board-1-item-7', {
        taskId: 'board-1-item-7',
        status: ResponseStatus.ACCEPTED
      });

      // When: 리뷰 작업을 처리하면
      await planner.handleReviewTasks();

      // Then: 피드백 처리 요청이 전달되어야 함
      const feedbackRequests = mockManagerCommunicator.getRequestsByAction('process_feedback');
      const relevantRequest = feedbackRequests.find(req => req.taskId === 'board-1-item-7');
      expect(relevantRequest).toBeDefined();
      expect(relevantRequest.comments).toHaveLength(1);
      expect(relevantRequest.comments[0].content).toContain('code style issues');
    });
  });

  describe('병합 워크플로우 통합', () => {
    it('승인부터 병합 완료까지 전체 워크플로우를 처리해야 한다', async () => {
      // Given: IN_REVIEW 상태의 작업
      await mockProjectBoardService.updateItemStatus('board-1-item-8', 'IN_REVIEW');
      await mockProjectBoardService.addPullRequestToItem('board-1-item-8', 'https://github.com/wlgns5376/ai-devteam-test/pull/7');
      
      // Step 1: PR이 승인됨
      mockPullRequestService.setPullRequestState('https://github.com/wlgns5376/ai-devteam-test/pull/7', ReviewState.APPROVED);
      
      mockManagerCommunicator.setResponse('board-1-item-8', {
        taskId: 'board-1-item-8',
        status: ResponseStatus.ACCEPTED
      });

      // When: 첫 번째 리뷰 처리 (병합 요청)
      await planner.handleReviewTasks();
      
      // Then: 병합 요청이 전달되어야 함
      let mergeRequests = mockManagerCommunicator.getRequestsByAction('request_merge');
      expect(mergeRequests.length).toBe(1);
      expect(mergeRequests[0].taskId).toBe('board-1-item-8');

      // Given: Worker가 병합을 성공적으로 완료
      mockManagerCommunicator.clearRequests();
      mockManagerCommunicator.setResponse('board-1-item-8', {
        taskId: 'board-1-item-8',
        status: ResponseStatus.COMPLETED,
        message: 'merged'
      });

      // When: 두 번째 리뷰 처리 (병합 완료 확인)
      await planner.handleReviewTasks();

      // Then: 작업이 DONE 상태로 변경되어야 함
      const doneItems = await mockProjectBoardService.getItems('board-1', 'DONE');
      const completedTask = doneItems.find(item => item.id === 'board-1-item-8');
      expect(completedTask).toBeDefined();
    });

    it('Worker 없음으로 병합 실패 시 재시도해야 한다', async () => {
      // Given: 병합 요청 시 Worker가 없음
      await mockProjectBoardService.updateItemStatus('board-1-item-9', 'IN_REVIEW');
      await mockProjectBoardService.setPullRequestToItem('board-1-item-9', 'https://github.com/wlgns5376/ai-devteam-test/pull/8');
      
      mockPullRequestService.setPullRequestState('https://github.com/wlgns5376/ai-devteam-test/pull/8', ReviewState.APPROVED);
      
      mockManagerCommunicator.setResponse('board-1-item-9', {
        taskId: 'board-1-item-9',
        status: ResponseStatus.REJECTED,
        message: 'No available workers'
      });

      // When: 리뷰 작업을 처리하면
      await planner.handleReviewTasks();

      // Then: 작업이 IN_REVIEW 상태를 유지하고 재시도 가능해야 함
      const reviewItems = await mockProjectBoardService.getItems('board-1', 'IN_REVIEW');
      const retryTask = reviewItems.find(item => item.id === 'board-1-item-9');
      expect(retryTask).toBeDefined();
    });
  });

  describe('병합 후 정리', () => {
    it('병합 성공 시 활성 작업에서 제거되어야 한다', async () => {
      // Given: 병합이 성공적으로 완료된 작업
      await mockProjectBoardService.updateItemStatus('board-1-item-10', 'IN_REVIEW');
      await mockProjectBoardService.setPullRequestToItem('board-1-item-10', 'https://github.com/wlgns5376/ai-devteam-test/pull/9');
      
      mockPullRequestService.setPullRequestState('https://github.com/wlgns5376/ai-devteam-test/pull/9', ReviewState.APPROVED);
      
      mockManagerCommunicator.setResponse('board-1-item-10', {
        taskId: 'board-1-item-10',
        status: ResponseStatus.COMPLETED,
        message: 'merged'
      });

      // When: 리뷰 작업을 처리하면
      await planner.handleReviewTasks();

      // Then: 활성 작업 수가 감소해야 함
      const status = planner.getStatus();
      expect(status.activeTasks).toBe(0);
    });
  });
});
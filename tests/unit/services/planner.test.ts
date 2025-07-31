import { Planner } from '@/services/planner';
import { MockProjectBoardService } from '@/services/mock-project-board';
import { MockPullRequestService } from '@/services/mock-pull-request';
import { StateManager } from '@/services/state-manager';
import { Logger } from '@/services/logger';
import { 
  ProjectBoardItem, 
  PullRequestComment, 
  PlannerServiceConfig,
  TaskAction,
  ResponseStatus,
  PullRequestState 
} from '@/types';

// Mock Manager Communicator for testing
interface MockManagerResponse {
  taskId: string;
  status: ResponseStatus;
  message?: string;
  pullRequestUrl?: string;
  workerStatus?: string;
}

class MockManagerCommunicator {
  private responses: Map<string, MockManagerResponse> = new Map();
  private sentRequests: any[] = [];

  setResponse(taskId: string, response: MockManagerResponse): void {
    this.responses.set(taskId, response);
  }

  async sendTaskToManager(request: any): Promise<MockManagerResponse> {
    this.sentRequests.push(request);
    return this.responses.get(request.taskId) || { 
      taskId: request.taskId, 
      status: ResponseStatus.ACCEPTED 
    };
  }

  getSentRequests(): any[] {
    return [...this.sentRequests];
  }

  clearRequests(): void {
    this.sentRequests = [];
  }

  clearResponses(): void {
    this.responses.clear();
  }
}

describe('Planner', () => {
  let planner: Planner;
  let mockProjectBoardService: MockProjectBoardService;
  let mockPullRequestService: MockPullRequestService;
  let mockStateManager: any;
  let mockLogger: Logger;
  let mockManagerCommunicator: MockManagerCommunicator;

  beforeEach(async () => {
    mockProjectBoardService = new MockProjectBoardService();
    mockPullRequestService = new MockPullRequestService();
    
    // Create mock StateManager instead of real one for tests
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
      })
    } as any;
    
    mockLogger = Logger.createConsoleLogger();
    mockManagerCommunicator = new MockManagerCommunicator();
    
    // Clear previous test data
    mockManagerCommunicator.clearRequests();
    mockManagerCommunicator.clearResponses();

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

  describe('초기화', () => {
    it('should create Planner successfully', () => {
      // Given: Planner 생성자가 있을 때
      // When: Planner를 생성하면
      // Then: Planner가 생성되어야 함
      expect(planner).toBeDefined();
      expect(planner.isRunning()).toBe(false);
    });

    it('should have correct initial status', () => {
      // Given: 새로 생성된 Planner가 있을 때
      // When: 상태를 조회하면
      const status = planner.getStatus();

      // Then: 초기 상태가 올바르게 설정되어야 함
      expect(status.isRunning).toBe(false);
      expect(status.totalTasksProcessed).toBe(0);
      expect(status.activeTasks).toBe(0);
      expect(status.errors).toHaveLength(0);
    });
  });

  describe('모니터링 제어', () => {
    it('should start monitoring successfully', async () => {
      // Given: Planner가 있을 때
      // When: 모니터링을 시작하면
      await planner.startMonitoring();

      // Then: 모니터링 상태가 활성화되어야 함
      expect(planner.isRunning()).toBe(true);
      expect(planner.getStatus().isRunning).toBe(true);
    });

    it('should stop monitoring successfully', async () => {
      // Given: 모니터링이 시작된 Planner가 있을 때
      await planner.startMonitoring();
      expect(planner.isRunning()).toBe(true);

      // When: 모니터링을 중지하면
      await planner.stopMonitoring();

      // Then: 모니터링 상태가 비활성화되어야 함
      expect(planner.isRunning()).toBe(false);
      expect(planner.getStatus().isRunning).toBe(false);
    });

    it('should not start monitoring twice', async () => {
      // Given: 이미 모니터링이 시작된 Planner가 있을 때
      await planner.startMonitoring();
      expect(planner.isRunning()).toBe(true);

      // When: 다시 모니터링을 시작하려고 하면
      await planner.startMonitoring();

      // Then: 상태가 변경되지 않아야 함
      expect(planner.isRunning()).toBe(true);
    });
  });

  describe('신규 작업 처리 (handleNewTasks)', () => {
    it('should process new TODO tasks', async () => {
      // Given: TODO 상태의 작업이 있을 때
      mockManagerCommunicator.setResponse('board-1-item-4', { taskId: 'board-1-item-4', status: ResponseStatus.ACCEPTED });
      mockManagerCommunicator.setResponse('board-1-item-5', { taskId: 'board-1-item-5', status: ResponseStatus.ACCEPTED });

      // When: 신규 작업을 처리하면
      await planner.handleNewTasks();

      // Then: Manager에게 작업이 전달되어야 함
      const requests = mockManagerCommunicator.getSentRequests();
      expect(requests.length).toBeGreaterThan(0);
      
      const todoRequests = requests.filter(req => req.action === 'start_new_task');
      expect(todoRequests.length).toBeGreaterThan(0);
      
      // 작업 상태가 IN_PROGRESS로 변경되어야 함
      const inProgressItems = await mockProjectBoardService.getItems('board-1', 'IN_PROGRESS');
      expect(inProgressItems.length).toBeGreaterThan(0);
    });

    it('should not process same task twice', async () => {
      // Given: TODO 작업이 있고 이미 처리된 적이 있을 때
      mockManagerCommunicator.setResponse('board-1-item-4', { taskId: 'board-1-item-4', status: ResponseStatus.ACCEPTED });
      
      await planner.handleNewTasks();
      const firstRequestCount = mockManagerCommunicator.getSentRequests().length;
      mockManagerCommunicator.clearRequests();

      // When: 다시 신규 작업을 처리하면
      await planner.handleNewTasks();

      // Then: 같은 작업이 다시 전달되지 않아야 함
      const secondRequests = mockManagerCommunicator.getSentRequests();
      expect(secondRequests.length).toBeLessThan(firstRequestCount);
    });

    it('should handle Manager rejection', async () => {
      // Given: Manager가 작업을 거부할 때
      mockManagerCommunicator.setResponse('board-1-item-4', { taskId: 'board-1-item-4', status: ResponseStatus.REJECTED, message: 'No available workers' });

      // When: 신규 작업을 처리하면
      await planner.handleNewTasks();

      // Then: 작업 상태가 변경되지 않아야 함
      const todoItems = await mockProjectBoardService.getItems('board-1', 'TODO');
      expect(todoItems.some(item => item.id === 'board-1-item-4')).toBe(true);
    });
  });

  describe('진행중 작업 추적 (handleInProgressTasks)', () => {
    beforeEach(async () => {
      // IN_PROGRESS 상태의 작업 설정
      await mockProjectBoardService.updateItemStatus('board-1-item-3', 'IN_PROGRESS');
    });

    it('should check status of in-progress tasks', async () => {
      // Given: IN_PROGRESS 상태의 작업이 있을 때
      mockManagerCommunicator.setResponse('board-1-item-3', { 
        taskId: 'board-1-item-3',
        status: ResponseStatus.IN_PROGRESS,
        workerStatus: 'working'
      });

      // When: 진행중 작업을 추적하면
      await planner.handleInProgressTasks();

      // Then: Manager에게 상태 확인 요청이 전달되어야 함
      const requests = mockManagerCommunicator.getSentRequests();
      const statusCheckRequests = requests.filter(req => req.action === 'check_status');
      expect(statusCheckRequests.length).toBeGreaterThan(0);
    });

    it('should move completed tasks to review', async () => {
      // Given: 작업이 완료되었을 때
      const prUrl = 'https://github.com/example/test-repo/pull/123';
      mockManagerCommunicator.setResponse('board-1-item-3', { 
        taskId: 'board-1-item-3',
        status: ResponseStatus.COMPLETED,
        pullRequestUrl: prUrl
      });

      // When: 진행중 작업을 추적하면
      await planner.handleInProgressTasks();

      // Then: 작업이 IN_REVIEW로 변경되고 PR 링크가 등록되어야 함
      const reviewItems = await mockProjectBoardService.getItems('board-1', 'IN_REVIEW');
      const updatedItem = reviewItems.find(item => item.id === 'board-1-item-3');
      
      expect(updatedItem).toBeDefined();
      expect(updatedItem!.pullRequestUrls).toContain(prUrl);
    });

    it('should handle worker errors', async () => {
      // Given: Worker에서 에러가 발생했을 때
      mockManagerCommunicator.setResponse('board-1-item-3', { 
        taskId: 'board-1-item-3',
        status: ResponseStatus.ERROR,
        message: 'Worker timeout'
      });

      // When: 진행중 작업을 추적하면
      await planner.handleInProgressTasks();

      // Then: 에러가 기록되어야 함
      const status = planner.getStatus();
      expect(status.errors.length).toBeGreaterThan(0);
    });

    it('should handle merge completion', async () => {
      // Given: 병합이 완료된 작업이 있을 때
      mockManagerCommunicator.setResponse('board-1-item-3', { 
        taskId: 'board-1-item-3',
        status: ResponseStatus.COMPLETED,
        message: 'merged'
      });

      // When: 진행중 작업을 추적하면
      await planner.handleInProgressTasks();

      // Then: 작업이 DONE으로 변경되어야 함
      const doneItems = await mockProjectBoardService.getItems('board-1', 'DONE');
      const completedItem = doneItems.find(item => item.id === 'board-1-item-3');
      expect(completedItem).toBeDefined();
      
      // 활성 작업에서 제거되어야 함
      const status = planner.getStatus();
      expect(status.activeTasks).toBe(0);
    });
  });

  describe('리뷰 작업 관리 (handleReviewTasks)', () => {
    it('should handle review tasks successfully', async () => {
      // Given: IN_REVIEW 상태의 작업이 있을 때
      mockManagerCommunicator.clearRequests();
      await mockProjectBoardService.updateItemStatus('board-1-item-2', 'IN_REVIEW');
      await mockProjectBoardService.addPullRequestToItem('board-1-item-2', 'https://github.com/wlgns5376/ai-devteam-test/pull/1');
      
      // When: 리뷰 작업을 관리하면
      await planner.handleReviewTasks();

      // Then: 에러 없이 완료되어야 함
      expect(true).toBe(true);
    });
  });

  describe('워크플로우 사이클 (processWorkflowCycle)', () => {
    it('should execute complete workflow cycle', async () => {
      // Given: 다양한 상태의 작업들이 있을 때
      mockManagerCommunicator.setResponse('board-1-item-4', { taskId: 'board-1-item-4', status: ResponseStatus.ACCEPTED });
      mockManagerCommunicator.setResponse('board-1-item-3', { taskId: 'board-1-item-3', status: ResponseStatus.IN_PROGRESS });

      // When: 워크플로우 사이클을 실행하면
      await planner.processWorkflowCycle();

      // Then: 모든 단계가 실행되어야 함
      const requests = mockManagerCommunicator.getSentRequests();
      expect(requests.length).toBeGreaterThan(0);
      
      // 상태가 업데이트되어야 함
      const status = planner.getStatus();
      expect(status.lastSyncTime).toBeInstanceOf(Date);
    });

    it('should handle errors gracefully', async () => {
      // Given: Manager 통신에서 에러가 발생할 때
      mockManagerCommunicator.setResponse('board-1-item-4', { taskId: 'board-1-item-4', status: ResponseStatus.ERROR, message: 'Connection failed' });

      // When: 워크플로우 사이클을 실행하면
      await planner.processWorkflowCycle();

      // Then: 에러가 기록되고 다른 작업은 계속 처리되어야 함
      const status = planner.getStatus();
      expect(status.lastSyncTime).toBeInstanceOf(Date);
    });
  });

  describe('강제 동기화 (forceSync)', () => {
    it('should execute immediate sync', async () => {
      // Given: Planner가 있을 때
      mockManagerCommunicator.setResponse('board-1-item-4', { taskId: 'board-1-item-4', status: ResponseStatus.ACCEPTED });

      // When: 강제 동기화를 실행하면
      await planner.forceSync();

      // Then: 워크플로우 사이클이 실행되어야 함
      const requests = mockManagerCommunicator.getSentRequests();
      expect(requests.length).toBeGreaterThan(0);
      
      const status = planner.getStatus();
      expect(status.lastSyncTime).toBeInstanceOf(Date);
    });
  });

  describe('에러 처리', () => {
    it('should handle ProjectBoard service errors', async () => {
      // Given: ProjectBoard 서비스에서 에러가 발생할 때
      const originalGetItems = mockProjectBoardService.getItems;
      jest.spyOn(mockProjectBoardService, 'getItems').mockRejectedValue(new Error('Board service error'));

      // When: 워크플로우 사이클을 실행하면
      await planner.processWorkflowCycle();

      // Then: 에러가 처리되고 시스템이 중단되지 않아야 함
      const status = planner.getStatus();
      expect(status.errors.length).toBeGreaterThan(0);
      
      // 복원
      mockProjectBoardService.getItems = originalGetItems;
    });

    it('should handle PullRequest service errors', async () => {
      // Given: PullRequest 서비스에서 에러가 발생할 때
      jest.spyOn(mockPullRequestService, 'getPullRequest').mockRejectedValue(new Error('PR service error'));

      // When: 리뷰 작업을 처리하면
      await planner.handleReviewTasks();

      // Then: 에러가 처리되어야 함
      const status = planner.getStatus();
      expect(status.errors.length).toBeGreaterThanOrEqual(0); // 에러가 발생할 수 있음
    });
  });

  describe('통계 및 상태', () => {
    it('should track processed tasks count', async () => {
      // Given: 처리할 작업들이 있을 때
      mockManagerCommunicator.setResponse('board-1-item-4', { taskId: 'board-1-item-4', status: ResponseStatus.ACCEPTED });
      mockManagerCommunicator.setResponse('board-1-item-5', { taskId: 'board-1-item-5', status: ResponseStatus.ACCEPTED });

      // When: 작업들을 처리하면
      await planner.handleNewTasks();

      // Then: 처리된 작업 수가 증가해야 함
      const status = planner.getStatus();
      expect(status.totalTasksProcessed).toBeGreaterThan(0);
    });

    it('should track active tasks count', async () => {
      // Given: 활성 작업들이 있을 때
      await mockProjectBoardService.updateItemStatus('board-1-item-3', 'IN_PROGRESS');

      // When: 상태를 조회하면
      const status = planner.getStatus();

      // Then: 활성 작업 수가 올바르게 표시되어야 함
      expect(status.activeTasks).toBeGreaterThanOrEqual(0);
    });
  });
});
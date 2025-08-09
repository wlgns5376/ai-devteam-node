import { Planner } from '@/services/planner';
import { WorkerPoolManager } from '@/services/manager/worker-pool-manager';
import { MockProjectBoardService } from '@/services/mock-project-board';
import { MockPullRequestService } from '@/services/mock-pull-request';
import { Logger } from '@/services/logger';
import { 
  PlannerServiceConfig,
  ResponseStatus,
  WorkerStatus
} from '@/types';

// Mock Manager Communicator for testing
class MockManagerCommunicator {
  private responses: Map<string, any> = new Map();
  private sentRequests: any[] = [];
  private workerFailures: Set<string> = new Set();

  setWorkerFailure(taskId: string): void {
    this.workerFailures.add(taskId);
  }

  setResponse(taskId: string, response: any): void {
    this.responses.set(taskId, response);
  }

  async sendTaskToManager(request: any): Promise<any> {
    this.sentRequests.push(request);
    
    // Worker 실패 시뮬레이션
    if (this.workerFailures.has(request.taskId) && request.action === 'check_status') {
      return { 
        taskId: request.taskId, 
        status: ResponseStatus.ERROR,
        message: 'Worker stopped unexpectedly'
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

  clearRequests(): void {
    this.sentRequests = [];
  }
}

describe('작업 재할당 시나리오', () => {
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
      })
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

  describe('Worker 실패 감지 및 재할당', () => {
    it('Worker 실패 시 새로운 Worker에게 작업을 재할당해야 한다', async () => {
      // Given: IN_PROGRESS 상태의 작업이 있고, Worker가 실패함
      await mockProjectBoardService.updateItemStatus('board-1-item-3', 'IN_PROGRESS');
      mockManagerCommunicator.setWorkerFailure('board-1-item-3');
      
      // 첫 번째 상태 확인에서 실패 반환
      mockManagerCommunicator.setResponse('board-1-item-3', {
        taskId: 'board-1-item-3',
        status: ResponseStatus.ERROR,
        message: 'Worker stopped unexpectedly'
      });

      // When: 진행중 작업을 추적하면
      await planner.handleInProgressTasks();

      // Then: 재할당 요청이 전달되어야 함
      const requests = mockManagerCommunicator.getSentRequests();
      const reassignmentRequests = requests.filter(req => 
        req.taskId === 'board-1-item-3' && 
        (req.action === 'reassign_task' || req.action === 'start_new_task')
      );
      
      expect(reassignmentRequests.length).toBeGreaterThan(0);
    });

    it('Worker 타임아웃 시 작업을 재할당해야 한다', async () => {
      // Given: 장시간 응답 없는 Worker가 있음
      await mockProjectBoardService.updateItemStatus('board-1-item-4', 'IN_PROGRESS');
      
      mockManagerCommunicator.setResponse('board-1-item-4', {
        taskId: 'board-1-item-4',
        status: ResponseStatus.ERROR,
        message: 'Worker timeout'
      });

      // When: 진행중 작업을 추적하면
      await planner.handleInProgressTasks();

      // Then: 에러가 기록되고 재할당이 시도되어야 함
      const status = planner.getStatus();
      expect(status.errors.length).toBeGreaterThan(0);
      
      const errorMessage = status.errors[0];
      expect(errorMessage).toContain('Worker timeout');
    });

    it('재할당 실패 시 작업 상태를 TODO로 되돌려야 한다', async () => {
      // Given: Worker 실패 후 재할당도 실패하는 상황
      await mockProjectBoardService.updateItemStatus('board-1-item-5', 'IN_PROGRESS');
      
      mockManagerCommunicator.setResponse('board-1-item-5', {
        taskId: 'board-1-item-5',
        status: ResponseStatus.REJECTED,
        message: 'No available workers'
      });

      // When: 진행중 작업을 추적하면
      await planner.handleInProgressTasks();

      // Then: 작업이 TODO 상태로 되돌아가야 함
      const todoItems = await mockProjectBoardService.getItems('board-1', 'TODO');
      const revertedTask = todoItems.find(item => item.id === 'board-1-item-5');
      expect(revertedTask).toBeDefined();
    });

    it('재할당된 작업의 진행상황을 추적해야 한다', async () => {
      // Given: 재할당된 작업이 성공적으로 완료됨
      await mockProjectBoardService.updateItemStatus('board-1-item-6', 'IN_PROGRESS');
      
      // 첫 번째 호출에서는 실패, 두 번째 호출에서는 완료
      let callCount = 0;
      const originalSendTask = mockManagerCommunicator.sendTaskToManager.bind(mockManagerCommunicator);
      mockManagerCommunicator.sendTaskToManager = jest.fn().mockImplementation(async (request) => {
        callCount++;
        if (callCount === 1) {
          return {
            taskId: request.taskId,
            status: ResponseStatus.ERROR,
            message: 'Worker failed'
          };
        } else {
          return {
            taskId: request.taskId,
            status: ResponseStatus.COMPLETED,
            pullRequestUrl: 'https://github.com/example/test-repo/pull/456'
          };
        }
      });

      // When: 여러 번 진행중 작업을 추적하면
      await planner.handleInProgressTasks();
      mockManagerCommunicator.clearRequests();
      await planner.handleInProgressTasks();

      // Then: 재할당된 작업이 완료 처리되어야 함
      const reviewItems = await mockProjectBoardService.getItems('board-1', 'IN_REVIEW');
      const completedTask = reviewItems.find(item => item.id === 'board-1-item-6');
      expect(completedTask).toBeDefined();
      expect(completedTask!.pullRequestUrls).toContain('https://github.com/example/test-repo/pull/456');
    });
  });

  describe('재할당 정책', () => {
    it('동일한 작업을 여러 번 재할당하지 않아야 한다', async () => {
      // Given: 이미 재할당된 작업
      await mockProjectBoardService.updateItemStatus('board-1-item-7', 'IN_PROGRESS');
      
      mockManagerCommunicator.setResponse('board-1-item-7', {
        taskId: 'board-1-item-7',
        status: ResponseStatus.ERROR,
        message: 'Worker failed'
      });

      // When: 동일한 작업을 여러 번 확인하면
      await planner.handleInProgressTasks();
      const firstRequestCount = mockManagerCommunicator.getSentRequests().length;
      
      mockManagerCommunicator.clearRequests();
      await planner.handleInProgressTasks();
      const secondRequestCount = mockManagerCommunicator.getSentRequests().length;

      // Then: 재할당 요청이 중복되지 않아야 함
      expect(secondRequestCount).toBeLessThanOrEqual(firstRequestCount);
    });

    it('최대 재시도 횟수 초과 시 작업을 실패 처리해야 한다', async () => {
      // Given: 최대 재시도 횟수를 초과한 작업
      await mockProjectBoardService.updateItemStatus('board-1-item-8', 'IN_PROGRESS');
      
      // 항상 실패 응답
      mockManagerCommunicator.setResponse('board-1-item-8', {
        taskId: 'board-1-item-8',
        status: ResponseStatus.ERROR,
        message: 'Persistent worker failure'
      });

      // When: 여러 번 시도하면
      for (let i = 0; i < 5; i++) {
        await planner.handleInProgressTasks();
      }

      // Then: 에러가 누적 기록되어야 함
      const status = planner.getStatus();
      expect(status.errors.length).toBeGreaterThan(2);
    });
  });
});
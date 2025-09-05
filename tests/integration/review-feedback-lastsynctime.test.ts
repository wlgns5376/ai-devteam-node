import { ReviewTaskHandler } from '@/services/planner/review-task-handler';
import { WorkflowStateManager } from '@/services/planner/workflow-state-manager';
import { PlannerErrorManager } from '@/services/planner/planner-error-manager';
import { Logger } from '@/services/logger';
import { StateManager } from '@/services/state-manager';
import { 
  PlannerServiceConfig,
  ResponseStatus,
  PullRequestState,
  PullRequestComment,
  Task,
  TaskStatus,
  TaskPriority,
  Worker as WorkerType,
  WorkerStatus,
  WorkerAction
} from '@/types';
import fs from 'fs/promises';
import path from 'path';

describe('Review 피드백 lastSyncTime 통합 테스트', () => {
  let reviewTaskHandler: ReviewTaskHandler;
  let mockDependencies: any;
  let mockWorkflowStateManager: any;
  let mockErrorManager: any;
  let mockLogger: Logger;
  let mockConfig: PlannerServiceConfig;
  let stateManager: StateManager;
  let testDataDir: string;

  beforeEach(async () => {
    // 테스트용 임시 디렉토리
    testDataDir = path.join(__dirname, `test-data-${Date.now()}`);
    await fs.mkdir(testDataDir, { recursive: true });
    
    // 실제 StateManager 인스턴스 생성
    stateManager = new StateManager(testDataDir);
    await stateManager.initialize();
    
    // StateManager 메서드들에 spy 추가
    jest.spyOn(stateManager, 'updateTaskLastSyncTime');
    jest.spyOn(stateManager, 'addProcessedCommentsToTask');

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
      stateManager: stateManager,
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

  afterEach(async () => {
    // 테스트 데이터 정리
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  describe('Worker 상태 변경 시나리오', () => {
    it('Worker가 작업 완료 후 대기 상태로 전환되어도 lastSyncTime이 유지되어야 한다', async () => {
      // Given: Task와 Worker 설정
      const task: Task = {
        id: 'task-1',
        title: 'Test Task',
        description: 'Test Description',
        projectId: 'test-project',
        status: TaskStatus.IN_REVIEW,
        priority: TaskPriority.MEDIUM,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      await stateManager.saveTask(task);

      // Worker 생성 및 작업 할당
      const worker: WorkerType = {
        id: 'worker-1',
        status: WorkerStatus.WORKING,
        currentTask: {
          taskId: 'task-1',
          action: WorkerAction.PROCESS_FEEDBACK,
          lastSyncTime: new Date('2024-01-01T10:00:00Z'),
          assignedAt: new Date(),
          repositoryId: 'owner/repo'
        },
        workspaceDir: '/test/workspace',
        developerType: 'claude',
        createdAt: new Date(),
        lastActiveAt: new Date(),
      };
      
      await stateManager.saveWorker(worker);

      // 첫 번째 lastSyncTime 업데이트
      const firstSyncTime = new Date('2024-01-01T12:00:00Z');
      await stateManager.updateTaskLastSyncTime('task-1', firstSyncTime);

      // Worker를 대기 상태로 변경 (currentTask는 유지)
      const waitingWorker: WorkerType = {
        ...worker,
        status: WorkerStatus.WAITING,
        currentTask: {
          ...worker.currentTask!,
          lastSyncTime: firstSyncTime
        }
      };
      await stateManager.saveWorker(waitingWorker);

      // lastSyncTime이 유지되는지 확인
      const syncTime1 = await stateManager.getTaskLastSyncTime('task-1');
      expect(syncTime1).toEqual(firstSyncTime);

      // Worker의 currentTask를 null로 설정 (작업 완료 시뮬레이션)
      const idleWorker: WorkerType = {
        ...waitingWorker,
        status: WorkerStatus.IDLE,
        currentTask: undefined as any
      };
      await stateManager.saveWorker(idleWorker);

      // Task의 lastSyncTime이 여전히 유지되는지 확인
      const syncTime2 = await stateManager.getTaskLastSyncTime('task-1');
      expect(syncTime2).toEqual(firstSyncTime);

      // 리뷰 작업 설정
      const reviewItem = {
        id: 'task-1',
        title: 'Test Task',
        pullRequestUrls: ['https://github.com/owner/repo/pull/1']
      };
      
      mockDependencies.projectBoardService.getItems.mockResolvedValue([reviewItem]);
      
      // 새로운 코멘트 (lastSyncTime 이후)
      const newComments: PullRequestComment[] = [
        {
          id: 'comment-1',
          content: 'New feedback after sync',
          author: 'reviewer1',
          createdAt: new Date('2024-01-01T13:00:00Z'),
        }
      ];
      
      mockDependencies.pullRequestService.getNewComments.mockImplementation(
        (repoId: string, prNumber: number, since: Date) => {
          // since가 저장된 lastSyncTime과 동일한지 확인
          expect(since).toEqual(firstSyncTime);
          return Promise.resolve(newComments);
        }
      );

      // When: 리뷰 작업 처리
      await reviewTaskHandler.handle();

      // Then: 올바른 lastSyncTime으로 코멘트를 조회했는지 확인
      expect(mockDependencies.pullRequestService.getNewComments).toHaveBeenCalledWith(
        'owner/repo',
        1,
        firstSyncTime,
        expect.any(Object)
      );

      // 새로운 lastSyncTime이 업데이트되었는지 확인
      expect(mockDependencies.stateManager.updateTaskLastSyncTime).toHaveBeenCalledWith(
        'task-1',
        expect.any(Date)
      );
    });

    it('여러 번의 피드백 처리 과정에서 lastSyncTime이 올바르게 추적되어야 한다', async () => {
      // Given: Task 설정
      const task: Task = {
        id: 'task-2',
        title: 'Test Task 2',
        description: 'Test Description',
        projectId: 'test-project',
        status: TaskStatus.IN_REVIEW,
        priority: TaskPriority.MEDIUM,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      await stateManager.saveTask(task);

      const reviewItem = {
        id: 'task-2',
        title: 'Test Task 2',
        pullRequestUrls: ['https://github.com/owner/repo/pull/2']
      };
      
      mockDependencies.projectBoardService.getItems.mockResolvedValue([reviewItem]);

      // 첫 번째 피드백 처리
      const firstComments: PullRequestComment[] = [
        {
          id: 'comment-1',
          content: 'First feedback',
          author: 'reviewer1',
          createdAt: new Date('2024-01-01T10:00:00Z'),
        }
      ];
      
      mockDependencies.pullRequestService.getNewComments.mockResolvedValueOnce(firstComments);
      
      await reviewTaskHandler.handle();
      
      // 첫 번째 피드백 처리 후 lastSyncTime 확인
      const firstSyncTime = await stateManager.getTaskLastSyncTime('task-2');
      expect(firstSyncTime).not.toBeNull();

      // Worker 상태를 IDLE로 변경 (작업 완료 시뮬레이션)
      const workers = await stateManager.getAllWorkers();
      for (const worker of workers) {
        if (worker.currentTask?.taskId === 'task-2') {
          const updatedWorker: WorkerType = {
            ...worker,
            status: WorkerStatus.IDLE,
            currentTask: undefined as any
          };
          await stateManager.saveWorker(updatedWorker);
        }
      }

      // 두 번째 피드백 처리 (시간이 지난 후)
      await new Promise(resolve => setTimeout(resolve, 100)); // 시간 경과 시뮬레이션

      const secondComments: PullRequestComment[] = [
        {
          id: 'comment-2',
          content: 'Second feedback',
          author: 'reviewer2',
          createdAt: new Date('2024-01-01T11:00:00Z'),
        }
      ];
      
      mockDependencies.pullRequestService.getNewComments.mockImplementation(
        (repoId: string, prNumber: number, since: Date) => {
          // 이전에 저장된 lastSyncTime을 사용하는지 확인
          expect(since.getTime()).toBeGreaterThanOrEqual(firstSyncTime!.getTime());
          return Promise.resolve(secondComments);
        }
      );

      await reviewTaskHandler.handle();

      // 두 번째 피드백 처리 후 lastSyncTime이 업데이트되었는지 확인
      const secondSyncTime = await stateManager.getTaskLastSyncTime('task-2');
      expect(secondSyncTime).not.toBeNull();
      expect(secondSyncTime!.getTime()).toBeGreaterThan(firstSyncTime!.getTime());

      // 처리된 코멘트가 올바르게 기록되었는지 확인
      const processedComments = await stateManager.getProcessedCommentsForTask('task-2');
      expect(processedComments).toContain('comment-1');
      expect(processedComments).toContain('comment-2');
    });
  });
});
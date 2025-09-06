import { TaskRequestHandler } from '@/app/TaskRequestHandler';
import { WorkerPoolManager } from '@/services/manager/worker-pool-manager';
import { StateManager } from '@/services/state-manager';
import { Worker } from '@/services/worker/worker';
import { 
  WorkerAction, 
  WorkerStatus, 
  TaskAction, 
  ResponseStatus,
  WorkerTask
} from '@/types';
import { TestDataFactory } from '../../helpers/test-data-factory';
import { createMockLogger } from '../../shared/common-mocks';

describe('LastSyncTime Task Assignment Tests', () => {
  let taskRequestHandler: TaskRequestHandler;
  let workerPoolManager: WorkerPoolManager;
  let stateManager: StateManager;
  let mockWorkerInstance: Worker;
  
  beforeEach(() => {
    // Mock 초기화
    stateManager = {
      getTaskLastSyncTime: jest.fn(),
      updateTaskLastSyncTime: jest.fn(),
      saveWorker: jest.fn(),
      getWorker: jest.fn(),
      saveTask: jest.fn(),
      getTask: jest.fn()
    } as any;

    workerPoolManager = {
      getAvailableWorker: jest.fn(),
      assignWorkerTask: jest.fn(),
      getWorkerInstance: jest.fn(),
      getWorkerByTaskId: jest.fn(),
      storeTaskResult: jest.fn()
    } as any;

    mockWorkerInstance = {
      assignTask: jest.fn(),
      startExecution: jest.fn().mockResolvedValue({
        success: true,
        pullRequestUrl: 'https://github.com/owner/repo/pull/123'
      }),
      getStatus: jest.fn().mockReturnValue('waiting'),
      getCurrentTask: jest.fn()
    } as any;

    // WorkerPoolManager에 필요한 메서드들 추가
    workerPoolManager.getWorkspaceManager = jest.fn().mockReturnValue({
      saveWorkspaceInfo: jest.fn(),
      loadWorkspaceInfo: jest.fn()
    });
    workerPoolManager.getStateManager = jest.fn().mockReturnValue(stateManager);

    taskRequestHandler = new TaskRequestHandler(
      workerPoolManager,
      { updateItemStatus: jest.fn() } as any, // projectBoardService
      {} as any, // pullRequestService  
      createMockLogger(), // logger
      (boardItem) => 'test-repo', // extractRepositoryFromBoardItem
      { extractBaseBranch: jest.fn().mockResolvedValue('main') } as any // baseBranchExtractor
    );
  });

  describe('새로운 작업 시작 시', () => {
    it('Task의 lastSyncTime이 있으면 Worker에 전달되어야 함', async () => {
      // Given: lastSyncTime이 설정된 Task
      const taskId = 'PVTI_task_with_sync';
      const lastSyncTime = new Date('2025-01-01T10:00:00Z');
      
      (stateManager.getTaskLastSyncTime as jest.Mock).mockResolvedValue(lastSyncTime);
      (workerPoolManager.getAvailableWorker as jest.Mock).mockResolvedValue({
        id: 'worker-1',
        status: WorkerStatus.IDLE
      });
      (workerPoolManager.getWorkerInstance as jest.Mock).mockResolvedValue(mockWorkerInstance);

      const request = {
        taskId,
        action: TaskAction.START_NEW_TASK,
        boardItem: TestDataFactory.createMockBoardItem({ id: taskId })
      };

      // When: 새 작업 시작 요청
      await taskRequestHandler.handleTaskRequest(request);

      // Then: assignWorkerTask가 lastSyncTime을 포함한 task와 함께 호출되어야 함
      expect(workerPoolManager.assignWorkerTask).toHaveBeenCalled();
      const assignedTask = (workerPoolManager.assignWorkerTask as jest.Mock).mock.calls[0][1] as WorkerTask;
      
      expect(assignedTask.taskId).toBe(taskId);
      expect(assignedTask.action).toBe(WorkerAction.START_NEW_TASK);
      expect(assignedTask.lastSyncTime).toEqual(lastSyncTime);
    });

    it('Task의 lastSyncTime이 없으면 Worker에 전달되지 않아야 함', async () => {
      // Given: lastSyncTime이 없는 Task
      const taskId = 'PVTI_task_no_sync';
      
      (stateManager.getTaskLastSyncTime as jest.Mock).mockResolvedValue(null);
      (workerPoolManager.getAvailableWorker as jest.Mock).mockResolvedValue({
        id: 'worker-2',
        status: WorkerStatus.IDLE
      });

      const request = {
        taskId,
        action: TaskAction.START_NEW_TASK,
        boardItem: TestDataFactory.createMockBoardItem({ id: taskId })
      };

      // When: 새 작업 시작 요청
      await taskRequestHandler.handleTaskRequest(request);

      // Then: assignWorkerTask가 lastSyncTime 없이 호출되어야 함
      expect(workerPoolManager.assignWorkerTask).toHaveBeenCalled();
      const assignedTask = (workerPoolManager.assignWorkerTask as jest.Mock).mock.calls[0][1] as WorkerTask;
      
      expect(assignedTask.taskId).toBe(taskId);
      expect(assignedTask.lastSyncTime).toBeUndefined();
    });
  });

  describe('피드백 처리 시', () => {
    it('기존 Worker가 있는 경우 Task의 lastSyncTime이 전달되어야 함', async () => {
      // Given: lastSyncTime이 설정된 Task와 기존 Worker
      const taskId = 'PVTI_feedback_with_sync';
      const lastSyncTime = new Date('2025-01-02T14:30:00Z');
      const currentTask = {
        taskId,
        action: WorkerAction.START_NEW_TASK,
        assignedAt: new Date()
      };
      
      (stateManager.getTaskLastSyncTime as jest.Mock).mockResolvedValue(lastSyncTime);
      (workerPoolManager.getWorkerByTaskId as jest.Mock).mockResolvedValue({
        id: 'worker-3',
        status: WorkerStatus.WAITING,
        currentTask
      });
      (workerPoolManager.getWorkerInstance as jest.Mock).mockResolvedValue(mockWorkerInstance);

      const request = {
        taskId,
        action: TaskAction.PROCESS_FEEDBACK,
        boardItem: TestDataFactory.createMockBoardItem({ id: taskId }),
        comments: [{ 
          id: 'comment-1', 
          content: 'Fix this', 
          author: 'reviewer',
          createdAt: new Date() 
        }]
      };

      // When: 피드백 처리 요청
      await taskRequestHandler.handleTaskRequest(request);

      // Then: assignWorkerTask가 lastSyncTime을 포함한 task와 함께 호출되어야 함
      expect(workerPoolManager.assignWorkerTask).toHaveBeenCalled();
      const assignedTask = (workerPoolManager.assignWorkerTask as jest.Mock).mock.calls[0][1] as WorkerTask;
      
      expect(assignedTask.taskId).toBe(taskId);
      expect(assignedTask.action).toBe(WorkerAction.PROCESS_FEEDBACK);
      expect(assignedTask.lastSyncTime).toEqual(lastSyncTime);
      expect(assignedTask.comments).toBeDefined();
    });

    it('새 Worker를 할당하는 경우에도 Task의 lastSyncTime이 전달되어야 함', async () => {
      // Given: lastSyncTime이 설정된 Task, Worker가 없음
      const taskId = 'PVTI_feedback_new_worker';
      const lastSyncTime = new Date('2025-01-03T09:15:00Z');
      
      (stateManager.getTaskLastSyncTime as jest.Mock).mockResolvedValue(lastSyncTime);
      (workerPoolManager.getWorkerByTaskId as jest.Mock).mockResolvedValue(null);
      (workerPoolManager.getAvailableWorker as jest.Mock).mockResolvedValue({
        id: 'worker-4',
        status: WorkerStatus.IDLE
      });
      (workerPoolManager.getWorkerInstance as jest.Mock).mockResolvedValue(mockWorkerInstance);

      const request = {
        taskId,
        action: TaskAction.PROCESS_FEEDBACK,
        boardItem: TestDataFactory.createMockBoardItem({ id: taskId }),
        pullRequestUrl: 'https://github.com/owner/repo/pull/456',
        comments: [{ 
          id: 'comment-2', 
          content: 'Please update', 
          author: 'reviewer2',
          createdAt: new Date() 
        }]
      };

      // When: 피드백 처리 요청
      await taskRequestHandler.handleTaskRequest(request);

      // Then: 새 Worker에도 lastSyncTime이 전달되어야 함
      expect(workerPoolManager.assignWorkerTask).toHaveBeenCalled();
      const assignedTask = (workerPoolManager.assignWorkerTask as jest.Mock).mock.calls[0][1] as WorkerTask;
      
      expect(assignedTask.taskId).toBe(taskId);
      expect(assignedTask.action).toBe(WorkerAction.PROCESS_FEEDBACK);
      expect(assignedTask.lastSyncTime).toEqual(lastSyncTime);
    });
  });

  describe('작업 재할당 시', () => {
    it('Task의 lastSyncTime이 재할당된 Worker에 전달되어야 함', async () => {
      // Given: lastSyncTime이 설정된 Task, 재할당 필요
      const taskId = 'PVTI_reassign_with_sync';
      const lastSyncTime = new Date('2025-01-04T16:45:00Z');
      
      (stateManager.getTaskLastSyncTime as jest.Mock).mockResolvedValue(lastSyncTime);
      (workerPoolManager.getWorkerByTaskId as jest.Mock).mockResolvedValue(null); // Worker 없음
      (workerPoolManager.getAvailableWorker as jest.Mock).mockResolvedValue({
        id: 'worker-5',
        status: WorkerStatus.IDLE
      });

      const request = {
        taskId,
        action: TaskAction.CHECK_STATUS,
        boardItem: TestDataFactory.createMockBoardItem({ id: taskId })
      };

      // When: 상태 확인 요청 (재할당 트리거)
      await taskRequestHandler.handleTaskRequest(request);

      // Then: 재할당 시에도 lastSyncTime이 전달되어야 함
      expect(workerPoolManager.assignWorkerTask).toHaveBeenCalled();
      const assignedTask = (workerPoolManager.assignWorkerTask as jest.Mock).mock.calls[0][1] as WorkerTask;
      
      expect(assignedTask.taskId).toBe(taskId);
      expect(assignedTask.action).toBe(WorkerAction.RESUME_TASK);
      expect(assignedTask.lastSyncTime).toEqual(lastSyncTime);
    });
  });

  describe('병합 요청 시', () => {
    it('Task의 lastSyncTime이 병합 작업에 전달되어야 함', async () => {
      // Given: lastSyncTime이 설정된 Task, 병합 요청
      const taskId = 'PVTI_merge_with_sync';
      const lastSyncTime = new Date('2025-01-05T11:20:00Z');
      
      (stateManager.getTaskLastSyncTime as jest.Mock).mockResolvedValue(lastSyncTime);
      (workerPoolManager.getWorkerByTaskId as jest.Mock).mockResolvedValue(null);
      (workerPoolManager.getAvailableWorker as jest.Mock).mockResolvedValue({
        id: 'worker-6',
        status: WorkerStatus.IDLE
      });
      (workerPoolManager.getWorkerInstance as jest.Mock).mockResolvedValue(mockWorkerInstance);

      const request = {
        taskId,
        action: TaskAction.REQUEST_MERGE,
        boardItem: TestDataFactory.createMockBoardItem({ id: taskId }),
        pullRequestUrl: 'https://github.com/owner/repo/pull/789'
      };

      // When: 병합 요청
      await taskRequestHandler.handleTaskRequest(request);

      // Then: 병합 작업에도 lastSyncTime이 전달되어야 함
      expect(workerPoolManager.assignWorkerTask).toHaveBeenCalled();
      const assignedTask = (workerPoolManager.assignWorkerTask as jest.Mock).mock.calls[0][1] as WorkerTask;
      
      expect(assignedTask.taskId).toBe(taskId);
      expect(assignedTask.action).toBe(WorkerAction.MERGE_REQUEST);
      expect(assignedTask.lastSyncTime).toEqual(lastSyncTime);
      expect(assignedTask.pullRequestUrl).toBe('https://github.com/owner/repo/pull/789');
    });
  });

  describe('통합 시나리오', () => {
    it('작업 생성 -> 피드백 처리 -> 병합까지 lastSyncTime이 유지되어야 함', async () => {
      const taskId = 'PVTI_full_lifecycle';
      const initialSyncTime = new Date('2025-01-06T08:00:00Z');
      const updatedSyncTime = new Date('2025-01-06T10:00:00Z');
      
      // Step 1: 새 작업 시작 (lastSyncTime 없음)
      (stateManager.getTaskLastSyncTime as jest.Mock).mockResolvedValueOnce(null);
      (workerPoolManager.getAvailableWorker as jest.Mock).mockResolvedValue({
        id: 'worker-7',
        status: WorkerStatus.IDLE
      });

      await taskRequestHandler.handleTaskRequest({
        taskId,
        action: TaskAction.START_NEW_TASK,
        boardItem: TestDataFactory.createMockBoardItem({ id: taskId })
      });

      let assignedTask = (workerPoolManager.assignWorkerTask as jest.Mock).mock.calls[0][1] as WorkerTask;
      expect(assignedTask.lastSyncTime).toBeUndefined();

      // Step 2: 첫 번째 피드백 처리 (lastSyncTime 설정됨)
      (stateManager.getTaskLastSyncTime as jest.Mock).mockResolvedValueOnce(initialSyncTime);
      (workerPoolManager.getWorkerByTaskId as jest.Mock).mockResolvedValue({
        id: 'worker-7',
        status: WorkerStatus.WAITING,
        currentTask: { taskId }
      });

      await taskRequestHandler.handleTaskRequest({
        taskId,
        action: TaskAction.PROCESS_FEEDBACK,
        comments: [{ 
          id: 'comment-1', 
          content: 'Fix this',
          author: 'reviewer',
          createdAt: new Date() 
        }] as any
      });

      assignedTask = (workerPoolManager.assignWorkerTask as jest.Mock).mock.calls[1][1] as WorkerTask;
      expect(assignedTask.lastSyncTime).toEqual(initialSyncTime);

      // Step 3: 두 번째 피드백 처리 (lastSyncTime 업데이트됨)
      (stateManager.getTaskLastSyncTime as jest.Mock).mockResolvedValueOnce(updatedSyncTime);

      await taskRequestHandler.handleTaskRequest({
        taskId,
        action: TaskAction.PROCESS_FEEDBACK,
        comments: [{ 
          id: 'comment-2', 
          content: 'Almost there',
          author: 'reviewer',
          createdAt: new Date() 
        }] as any
      });

      assignedTask = (workerPoolManager.assignWorkerTask as jest.Mock).mock.calls[2][1] as WorkerTask;
      expect(assignedTask.lastSyncTime).toEqual(updatedSyncTime);

      // Step 4: 병합 요청 (lastSyncTime 유지됨)
      (stateManager.getTaskLastSyncTime as jest.Mock).mockResolvedValueOnce(updatedSyncTime);

      await taskRequestHandler.handleTaskRequest({
        taskId,
        action: TaskAction.REQUEST_MERGE,
        pullRequestUrl: 'https://github.com/owner/repo/pull/999'
      });

      assignedTask = (workerPoolManager.assignWorkerTask as jest.Mock).mock.calls[3][1] as WorkerTask;
      expect(assignedTask.lastSyncTime).toEqual(updatedSyncTime);
    });
  });
});
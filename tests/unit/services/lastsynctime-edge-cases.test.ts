import { StateManager } from '@/services/state-manager';
import { Task, TaskStatus, TaskPriority, Worker, WorkerStatus, WorkerAction } from '@/types';
import fs from 'fs/promises';
import path from 'path';

describe('lastSyncTime 엣지 케이스 테스트', () => {
  let stateManager: StateManager;
  let testDataDir: string;

  beforeEach(async () => {
    testDataDir = path.join(__dirname, `test-data-${Date.now()}`);
    await fs.mkdir(testDataDir, { recursive: true });
    stateManager = new StateManager(testDataDir);
    await stateManager.initialize();
  });

  afterEach(async () => {
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  describe('Worker 상태 전환과 lastSyncTime', () => {
    it('Worker가 없을 때도 Task의 lastSyncTime을 가져올 수 있어야 한다', async () => {
      // Given: Task만 존재하고 Worker는 없음
      const task: Task = {
        id: 'task-orphan',
        title: 'Orphan Task',
        description: 'Task without worker',
        projectId: 'test-project',
        status: TaskStatus.IN_REVIEW,
        priority: TaskPriority.HIGH,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSyncTime: new Date('2024-01-01T10:00:00Z')
      };
      
      await stateManager.saveTask(task);

      // When: lastSyncTime 조회
      const syncTime = await stateManager.getTaskLastSyncTime('task-orphan');

      // Then: Task에 저장된 lastSyncTime을 반환
      expect(syncTime).toEqual(new Date('2024-01-01T10:00:00Z'));
    });

    it('Worker의 currentTask가 다른 작업으로 변경되어도 이전 Task의 lastSyncTime이 유지되어야 한다', async () => {
      // Given: 첫 번째 Task와 Worker
      const task1: Task = {
        id: 'task-1',
        title: 'First Task',
        description: 'First task description',
        projectId: 'test-project',
        status: TaskStatus.IN_REVIEW,
        priority: TaskPriority.HIGH,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      await stateManager.saveTask(task1);

      const worker: Worker = {
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
      await stateManager.updateTaskLastSyncTime('task-1', new Date('2024-01-01T12:00:00Z'));

      // 두 번째 Task 생성
      const task2: Task = {
        id: 'task-2',
        title: 'Second Task',
        description: 'Second task description',
        projectId: 'test-project',
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.MEDIUM,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      await stateManager.saveTask(task2);

      // Worker를 새 작업에 할당
      const updatedWorker: Worker = {
        ...worker,
        currentTask: {
          taskId: 'task-2',
          action: WorkerAction.START_NEW_TASK,
          assignedAt: new Date(),
          repositoryId: 'owner/repo'
        }
      };
      
      await stateManager.saveWorker(updatedWorker);

      // When: 이전 Task의 lastSyncTime 조회
      const syncTime1 = await stateManager.getTaskLastSyncTime('task-1');
      const syncTime2 = await stateManager.getTaskLastSyncTime('task-2');

      // Then: 첫 번째 Task의 lastSyncTime은 유지되어야 함
      expect(syncTime1).toEqual(new Date('2024-01-01T12:00:00Z'));
      expect(syncTime2).toBeNull(); // 두 번째 Task는 아직 lastSyncTime이 없음
    });

    it('Task 데이터가 문자열로 저장되어 있어도 Date로 올바르게 변환되어야 한다', async () => {
      // Given: JSON 파일에서 로드된 것처럼 문자열로 저장된 lastSyncTime
      const tasksFile = path.join(testDataDir, 'tasks.json');
      const taskData = [{
        id: 'task-string-date',
        title: 'String Date Task',
        description: 'Task with string date',
        projectId: 'test-project',
        status: TaskStatus.IN_REVIEW,
        priority: TaskPriority.HIGH,
        createdAt: '2024-01-01T08:00:00.000Z',
        updatedAt: '2024-01-01T08:00:00.000Z',
        lastSyncTime: '2024-01-01T10:00:00.000Z' // 문자열로 저장
      }];
      
      await fs.writeFile(tasksFile, JSON.stringify(taskData));
      
      // StateManager 재초기화하여 파일에서 로드
      stateManager = new StateManager(testDataDir);
      await stateManager.initialize();

      // When: lastSyncTime 조회
      const syncTime = await stateManager.getTaskLastSyncTime('task-string-date');

      // Then: Date 객체로 변환되어 반환
      expect(syncTime).toBeInstanceOf(Date);
      expect(syncTime).toEqual(new Date('2024-01-01T10:00:00.000Z'));
    });

    it('processedCommentIds가 없는 Task도 빈 배열을 반환해야 한다', async () => {
      // Given: processedCommentIds가 없는 Task
      const task: Task = {
        id: 'task-no-comments',
        title: 'Task without comments',
        description: 'No processed comments',
        projectId: 'test-project',
        status: TaskStatus.IN_REVIEW,
        priority: TaskPriority.LOW,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      await stateManager.saveTask(task);

      // When: 처리된 코멘트 조회
      const processedComments = await stateManager.getProcessedCommentsForTask('task-no-comments');

      // Then: 빈 배열 반환
      expect(processedComments).toEqual([]);
      expect(processedComments).toBeInstanceOf(Array);
    });

    it('동시에 여러 스레드에서 lastSyncTime을 업데이트해도 안전해야 한다', async () => {
      // Given: Task 생성
      const task: Task = {
        id: 'task-concurrent',
        title: 'Concurrent Task',
        description: 'Task for concurrent test',
        projectId: 'test-project',
        status: TaskStatus.IN_REVIEW,
        priority: TaskPriority.HIGH,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      await stateManager.saveTask(task);

      // When: 동시에 여러 업데이트 시도
      const updatePromises = [];
      for (let i = 0; i < 10; i++) {
        const syncTime = new Date(Date.now() + i * 1000); // 1초씩 차이나는 시간
        updatePromises.push(
          stateManager.updateTaskLastSyncTime('task-concurrent', syncTime)
        );
      }

      await Promise.all(updatePromises);

      // Then: 마지막 업데이트가 적용되어야 함
      const finalSyncTime = await stateManager.getTaskLastSyncTime('task-concurrent');
      expect(finalSyncTime).not.toBeNull();
      expect(finalSyncTime!.getTime()).toBeGreaterThanOrEqual(Date.now() - 1000); // 최근 시간이어야 함
    });
  });

  describe('복구 시나리오', () => {
    it('StateManager 재시작 후에도 lastSyncTime이 유지되어야 한다', async () => {
      // Given: Task와 lastSyncTime 저장
      const task: Task = {
        id: 'task-restart',
        title: 'Restart Task',
        description: 'Task for restart test',
        projectId: 'test-project',
        status: TaskStatus.IN_REVIEW,
        priority: TaskPriority.MEDIUM,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      await stateManager.saveTask(task);
      
      const originalSyncTime = new Date('2024-01-01T15:00:00Z');
      await stateManager.updateTaskLastSyncTime('task-restart', originalSyncTime);

      // When: StateManager 재시작
      stateManager = new StateManager(testDataDir);
      await stateManager.initialize();

      // Then: lastSyncTime이 유지되어야 함
      const syncTimeAfterRestart = await stateManager.getTaskLastSyncTime('task-restart');
      expect(syncTimeAfterRestart).toEqual(originalSyncTime);
    });

    it('Worker 재할당 시 Task의 processedCommentIds가 유지되어야 한다', async () => {
      // Given: Task와 처리된 코멘트
      const task: Task = {
        id: 'task-reassign',
        title: 'Reassign Task',
        description: 'Task for reassignment',
        projectId: 'test-project',
        status: TaskStatus.IN_REVIEW,
        priority: TaskPriority.HIGH,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      await stateManager.saveTask(task);
      
      // 코멘트 처리 기록
      await stateManager.addProcessedCommentsToTask('task-reassign', ['comment-1', 'comment-2']);
      
      // Worker 생성 및 할당
      const worker1: Worker = {
        id: 'worker-1',
        status: WorkerStatus.WORKING,
        currentTask: {
          taskId: 'task-reassign',
          action: WorkerAction.PROCESS_FEEDBACK,
          assignedAt: new Date(),
          repositoryId: 'owner/repo'
        },
        workspaceDir: '/test/workspace',
        developerType: 'claude',
        createdAt: new Date(),
        lastActiveAt: new Date(),
      };
      
      await stateManager.saveWorker(worker1);

      // Worker 해제 (idle 상태로)
      const idleWorker: Worker = {
        ...worker1,
        status: WorkerStatus.IDLE,
        currentTask: undefined as any
      };
      await stateManager.saveWorker(idleWorker);

      // 새 Worker에 재할당
      const worker2: Worker = {
        id: 'worker-2',
        status: WorkerStatus.WORKING,
        currentTask: {
          taskId: 'task-reassign',
          action: WorkerAction.PROCESS_FEEDBACK,
          assignedAt: new Date(),
          repositoryId: 'owner/repo'
        },
        workspaceDir: '/test/workspace2',
        developerType: 'gemini',
        createdAt: new Date(),
        lastActiveAt: new Date(),
      };
      
      await stateManager.saveWorker(worker2);

      // When: 처리된 코멘트 조회
      const processedComments = await stateManager.getProcessedCommentsForTask('task-reassign');

      // Then: 처리된 코멘트가 유지되어야 함
      expect(processedComments).toContain('comment-1');
      expect(processedComments).toContain('comment-2');
      expect(processedComments).toHaveLength(2);
    });
  });
});
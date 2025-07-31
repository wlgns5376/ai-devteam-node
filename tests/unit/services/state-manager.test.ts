import fs from 'fs/promises';
import path from 'path';
import { StateManager } from '@/services/state-manager';
import { Task, TaskStatus, TaskPriority, Worker, WorkerStatus } from '@/types';

describe('StateManager', () => {
  const testDataDir = path.join(__dirname, '../../../test-data');
  let stateManager: StateManager;

  beforeEach(async () => {
    // Given: 테스트용 데이터 디렉토리 생성
    await fs.mkdir(testDataDir, { recursive: true });
    stateManager = new StateManager(testDataDir);
  });

  afterEach(async () => {
    // 테스트 데이터 정리
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (error) {
      // 디렉토리가 없을 수 있음
    }
  });

  describe('초기화', () => {
    it('should create state files if they do not exist', async () => {
      // Given: StateManager가 생성되었을 때
      // When: 초기화를 실행하면
      await stateManager.initialize();

      // Then: 상태 파일들이 생성되어야 함
      const tasksFile = path.join(testDataDir, 'tasks.json');
      const workersFile = path.join(testDataDir, 'workers.json');
      
      const tasksExist = await fs.access(tasksFile).then(() => true).catch(() => false);
      const workersExist = await fs.access(workersFile).then(() => true).catch(() => false);
      
      expect(tasksExist).toBe(true);
      expect(workersExist).toBe(true);
    });

    it('should load existing state files if they exist', async () => {
      // Given: 기존 상태 파일이 있을 때
      const existingTask: Task = {
        id: 'task-1',
        title: 'Existing Task',
        description: 'Test task',
        status: TaskStatus.TODO,
        priority: TaskPriority.HIGH,
        projectId: 'project-1',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01')
      };

      const tasksFile = path.join(testDataDir, 'tasks.json');
      await fs.writeFile(tasksFile, JSON.stringify([existingTask], null, 2));

      // When: StateManager를 초기화하면
      await stateManager.initialize();

      // Then: 기존 데이터를 로드해야 함
      const tasks = await stateManager.getAllTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.id).toBe('task-1');
    });
  });

  describe('Task 관리', () => {
    beforeEach(async () => {
      await stateManager.initialize();
    });

    it('should add a new task', async () => {
      // Given: 새로운 Task가 있을 때
      const newTask: Task = {
        id: 'task-1',
        title: 'New Task',
        description: 'Test task description',
        status: TaskStatus.TODO,
        priority: TaskPriority.MEDIUM,
        projectId: 'project-1',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // When: Task를 추가하면
      await stateManager.saveTask(newTask);

      // Then: Task가 저장되어야 함
      const savedTask = await stateManager.getTask('task-1');
      expect(savedTask).toBeDefined();
      expect(savedTask?.title).toBe('New Task');
    });

    it('should update existing task', async () => {
      // Given: 기존 Task가 있을 때
      const originalTask: Task = {
        id: 'task-1',
        title: 'Original Task',
        description: 'Original description',
        status: TaskStatus.TODO,
        priority: TaskPriority.LOW,
        projectId: 'project-1',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await stateManager.saveTask(originalTask);

      // When: Task를 업데이트하면
      const updatedTask: Task = {
        ...originalTask,
        title: 'Updated Task',
        status: TaskStatus.IN_PROGRESS,
        updatedAt: new Date()
      };

      await stateManager.saveTask(updatedTask);

      // Then: Task가 업데이트되어야 함
      const savedTask = await stateManager.getTask('task-1');
      expect(savedTask?.title).toBe('Updated Task');
      expect(savedTask?.status).toBe(TaskStatus.IN_PROGRESS);
    });

    it('should remove a task', async () => {
      // Given: Task가 저장되어 있을 때
      const task: Task = {
        id: 'task-to-remove',
        title: 'Task to Remove',
        description: 'This task will be removed',
        status: TaskStatus.TODO,
        priority: TaskPriority.HIGH,
        projectId: 'project-1',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await stateManager.saveTask(task);

      // When: Task를 제거하면
      await stateManager.removeTask('task-to-remove');

      // Then: Task가 제거되어야 함
      const removedTask = await stateManager.getTask('task-to-remove');
      expect(removedTask).toBeUndefined();
    });

    it('should get tasks by status', async () => {
      // Given: 다양한 상태의 Task들이 있을 때
      const tasks: Task[] = [
        {
          id: 'task-1',
          title: 'Todo Task',
          description: 'Todo task',
          status: TaskStatus.TODO,
          priority: TaskPriority.HIGH,
          projectId: 'project-1',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'task-2',
          title: 'In Progress Task',
          description: 'In progress task',
          status: TaskStatus.IN_PROGRESS,
          priority: TaskPriority.MEDIUM,
          projectId: 'project-1',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'task-3',
          title: 'Done Task',
          description: 'Done task',
          status: TaskStatus.DONE,
          priority: TaskPriority.LOW,
          projectId: 'project-1',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      for (const task of tasks) {
        await stateManager.saveTask(task);
      }

      // When: 특정 상태의 Task들을 조회하면
      const todoTasks = await stateManager.getTasksByStatus(TaskStatus.TODO);
      const inProgressTasks = await stateManager.getTasksByStatus(TaskStatus.IN_PROGRESS);

      // Then: 해당 상태의 Task들만 반환되어야 함
      expect(todoTasks).toHaveLength(1);
      expect(todoTasks[0]?.id).toBe('task-1');
      expect(inProgressTasks).toHaveLength(1);
      expect(inProgressTasks[0]?.id).toBe('task-2');
    });
  });

  describe('Worker 관리', () => {
    beforeEach(async () => {
      await stateManager.initialize();
    });

    it('should add a new worker', async () => {
      // Given: 새로운 Worker가 있을 때
      const newWorker: Worker = {
        id: 'worker-1',
        status: WorkerStatus.IDLE,
        workspaceDir: '/workspace/worker-1',
        developerType: 'claude',
        createdAt: new Date(),
        lastActiveAt: new Date()
      };

      // When: Worker를 추가하면
      await stateManager.saveWorker(newWorker);

      // Then: Worker가 저장되어야 함
      const savedWorker = await stateManager.getWorker('worker-1');
      expect(savedWorker).toBeDefined();
      expect(savedWorker?.developerType).toBe('claude');
    });

    it('should get workers by status', async () => {
      // Given: 다양한 상태의 Worker들이 있을 때
      const workers: Worker[] = [
        {
          id: 'worker-1',
          status: WorkerStatus.IDLE,
          workspaceDir: '/workspace/worker-1',
          developerType: 'claude',
          createdAt: new Date(),
          lastActiveAt: new Date()
        },
        {
          id: 'worker-2',
          status: WorkerStatus.WORKING,
          currentTask: {
            taskId: 'task-1',
            action: 'start_new_task' as any,
            assignedAt: new Date(),
            repositoryId: 'test/repo'
          },
          workspaceDir: '/workspace/worker-2',
          developerType: 'gemini',
          createdAt: new Date(),
          lastActiveAt: new Date()
        }
      ];

      for (const worker of workers) {
        await stateManager.saveWorker(worker);
      }

      // When: 특정 상태의 Worker들을 조회하면
      const idleWorkers = await stateManager.getWorkersByStatus(WorkerStatus.IDLE);
      const workingWorkers = await stateManager.getWorkersByStatus(WorkerStatus.WORKING);

      // Then: 해당 상태의 Worker들만 반환되어야 함
      expect(idleWorkers).toHaveLength(1);
      expect(idleWorkers[0]?.id).toBe('worker-1');
      expect(workingWorkers).toHaveLength(1);
      expect(workingWorkers[0]?.id).toBe('worker-2');
    });
  });

  describe('동시성 처리', () => {
    beforeEach(async () => {
      await stateManager.initialize();
    });

    it('should handle concurrent task updates', async () => {
      // Given: 동일한 Task에 대한 동시 업데이트가 있을 때
      const task: Task = {
        id: 'concurrent-task',
        title: 'Concurrent Task',
        description: 'Test concurrent updates',
        status: TaskStatus.TODO,
        priority: TaskPriority.MEDIUM,
        projectId: 'project-1',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await stateManager.saveTask(task);

      // When: 동시에 여러 업데이트를 실행하면
      const updatePromises = Array.from({ length: 5 }, (_, i) => {
        const updatedTask: Task = {
          ...task,
          title: `Updated Task ${i}`,
          updatedAt: new Date()
        };
        return stateManager.saveTask(updatedTask);
      });

      await Promise.all(updatePromises);

      // Then: 마지막 업데이트가 반영되어야 함
      const finalTask = await stateManager.getTask('concurrent-task');
      expect(finalTask?.title).toMatch(/^Updated Task \d$/);
    });
  });

  describe('Task별 코멘트 관리', () => {
    beforeEach(async () => {
      await stateManager.initialize();
    });

    it('should add processed comment to task', async () => {
      // Given: Task가 있을 때
      const task: Task = {
        id: 'task-with-comments',
        title: 'Task with Comments',
        description: 'Test task for comment processing',
        status: TaskStatus.IN_REVIEW,
        priority: TaskPriority.HIGH,
        projectId: 'project-1',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await stateManager.saveTask(task);

      // When: 처리된 코멘트를 추가하면
      await stateManager.addProcessedCommentToTask('task-with-comments', 'comment-1');

      // Then: Task에 처리된 코멘트 ID가 추가되어야 함
      const updatedTask = await stateManager.getTask('task-with-comments');
      expect(updatedTask?.processedCommentIds).toContain('comment-1');
    });

    it('should add multiple processed comments to task', async () => {
      // Given: Task가 있을 때
      const task: Task = {
        id: 'task-multi-comments',
        title: 'Task with Multiple Comments',
        description: 'Test task for multiple comment processing',
        status: TaskStatus.IN_REVIEW,
        priority: TaskPriority.HIGH,
        projectId: 'project-1',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await stateManager.saveTask(task);

      // When: 여러 처리된 코멘트를 추가하면
      const commentIds = ['comment-1', 'comment-2', 'comment-3'];
      await stateManager.addProcessedCommentsToTask('task-multi-comments', commentIds);

      // Then: Task에 모든 처리된 코멘트 ID가 추가되어야 함
      const updatedTask = await stateManager.getTask('task-multi-comments');
      expect(updatedTask?.processedCommentIds).toEqual(expect.arrayContaining(commentIds));
    });

    it('should not add duplicate comment IDs', async () => {
      // Given: Task에 이미 처리된 코멘트가 있을 때
      const task: Task = {
        id: 'task-duplicate-comments',
        title: 'Task with Duplicate Comments',
        description: 'Test task for duplicate comment handling',
        status: TaskStatus.IN_REVIEW,
        priority: TaskPriority.HIGH,
        projectId: 'project-1',
        processedCommentIds: ['comment-1'],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await stateManager.saveTask(task);

      // When: 중복된 코멘트 ID를 추가하면
      await stateManager.addProcessedCommentToTask('task-duplicate-comments', 'comment-1');

      // Then: 중복 추가되지 않아야 함
      const updatedTask = await stateManager.getTask('task-duplicate-comments');
      const commentCount = updatedTask?.processedCommentIds?.filter(id => id === 'comment-1').length;
      expect(commentCount).toBe(1);
    });

    it('should check if comment is processed for task', async () => {
      // Given: Task에 처리된 코멘트가 있을 때
      const task: Task = {
        id: 'task-check-processed',
        title: 'Task for Checking Processed Comments',
        description: 'Test task for checking processed comments',
        status: TaskStatus.IN_REVIEW,
        priority: TaskPriority.HIGH,
        projectId: 'project-1',
        processedCommentIds: ['processed-comment'],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await stateManager.saveTask(task);

      // When: 코멘트 처리 상태를 확인하면
      const isProcessed = await stateManager.isCommentProcessedForTask('task-check-processed', 'processed-comment');
      const isNotProcessed = await stateManager.isCommentProcessedForTask('task-check-processed', 'unprocessed-comment');

      // Then: 올바른 상태를 반환해야 함
      expect(isProcessed).toBe(true);
      expect(isNotProcessed).toBe(false);
    });

    it('should get processed comments for task', async () => {
      // Given: Task에 여러 처리된 코멘트가 있을 때
      const processedComments = ['comment-1', 'comment-2', 'comment-3'];
      const task: Task = {
        id: 'task-get-processed',
        title: 'Task for Getting Processed Comments',
        description: 'Test task for getting processed comments',
        status: TaskStatus.IN_REVIEW,
        priority: TaskPriority.HIGH,
        projectId: 'project-1',
        processedCommentIds: processedComments,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await stateManager.saveTask(task);

      // When: 처리된 코멘트들을 조회하면
      const retrievedComments = await stateManager.getProcessedCommentsForTask('task-get-processed');

      // Then: 모든 처리된 코멘트들이 반환되어야 함
      expect(retrievedComments).toEqual(processedComments);
    });

    it('should return empty array for task with no processed comments', async () => {
      // Given: 처리된 코멘트가 없는 Task가 있을 때
      const task: Task = {
        id: 'task-no-comments',
        title: 'Task with No Comments',
        description: 'Test task with no processed comments',
        status: TaskStatus.TODO,
        priority: TaskPriority.LOW,
        projectId: 'project-1',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await stateManager.saveTask(task);

      // When: 처리된 코멘트들을 조회하면
      const retrievedComments = await stateManager.getProcessedCommentsForTask('task-no-comments');

      // Then: 빈 배열이 반환되어야 함
      expect(retrievedComments).toEqual([]);
    });
  });

  describe('파일 시스템 오류 처리', () => {
    it('should handle file read errors gracefully', async () => {
      // Given: 존재하지 않는 디렉토리로 StateManager를 생성할 때
      const invalidDir = '/non-existent-directory';
      const invalidStateManager = new StateManager(invalidDir);

      // When & Then: 초기화 시 오류가 발생해야 함
      await expect(invalidStateManager.initialize()).rejects.toThrow();
    });

    it('should handle corrupted state files', async () => {
      // Given: 손상된 JSON 파일이 있을 때
      const tasksFile = path.join(testDataDir, 'tasks.json');
      await fs.writeFile(tasksFile, 'invalid json content');

      // When & Then: 초기화 시 오류가 발생해야 함
      await expect(stateManager.initialize()).rejects.toThrow();
    });
  });
});
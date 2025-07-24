import { TaskStatus, TaskPriority, Task, TaskUpdate } from '@/types/task.types';

describe('Task Types', () => {
  describe('TaskStatus enum', () => {
    it('should contain all required status values', () => {
      // Given: TaskStatus enum이 정의되어 있을 때
      // When: 모든 상태 값들을 확인하면
      // Then: 필요한 모든 상태가 존재해야 함
      expect(TaskStatus.TODO).toBe('todo');
      expect(TaskStatus.IN_PROGRESS).toBe('in-progress');
      expect(TaskStatus.IN_REVIEW).toBe('in-review');
      expect(TaskStatus.DONE).toBe('done');
    });

    it('should have exactly 4 status values', () => {
      // Given: TaskStatus enum이 정의되어 있을 때
      // When: enum의 값 개수를 확인하면
      // Then: 정확히 4개의 상태만 존재해야 함
      const statusValues = Object.values(TaskStatus);
      expect(statusValues).toHaveLength(4);
    });
  });

  describe('TaskPriority enum', () => {
    it('should contain all required priority values', () => {
      // Given: TaskPriority enum이 정의되어 있을 때
      // When: 모든 우선순위 값들을 확인하면
      // Then: 필요한 모든 우선순위가 존재해야 함
      expect(TaskPriority.HIGH).toBe('high');
      expect(TaskPriority.MEDIUM).toBe('medium');
      expect(TaskPriority.LOW).toBe('low');
    });

    it('should have exactly 3 priority values', () => {
      // Given: TaskPriority enum이 정의되어 있을 때
      // When: enum의 값 개수를 확인하면
      // Then: 정확히 3개의 우선순위만 존재해야 함
      const priorityValues = Object.values(TaskPriority);
      expect(priorityValues).toHaveLength(3);
    });
  });

  describe('Task interface', () => {
    it('should have all required properties with correct types', () => {
      // Given: Task 인터페이스를 구현한 객체가 있을 때
      const mockTask: Task = {
        id: 'task-1',
        title: 'Test Task',
        description: 'Test task description',
        status: TaskStatus.TODO,
        priority: TaskPriority.HIGH,
        projectId: 'project-1',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01')
      };

      // When: 각 속성을 확인하면
      // Then: 모든 필수 속성이 올바른 타입으로 존재해야 함
      expect(typeof mockTask.id).toBe('string');
      expect(typeof mockTask.title).toBe('string');
      expect(typeof mockTask.description).toBe('string');
      expect(Object.values(TaskStatus)).toContain(mockTask.status);
      expect(Object.values(TaskPriority)).toContain(mockTask.priority);
      expect(typeof mockTask.projectId).toBe('string');
      expect(mockTask.createdAt).toBeInstanceOf(Date);
      expect(mockTask.updatedAt).toBeInstanceOf(Date);
    });

    it('should support optional properties', () => {
      // Given: 선택적 속성들을 포함한 Task 객체가 있을 때
      const taskWithOptionals: Task = {
        id: 'task-2',
        title: 'Task with optionals',
        description: 'Task with optional properties',
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.MEDIUM,
        assignedWorker: 'worker-1',
        projectId: 'project-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        prUrl: 'https://github.com/test/test/pull/1',
        comments: ['comment 1', 'comment 2']
      };

      // When: 선택적 속성들을 확인하면
      // Then: 올바른 타입으로 존재해야 함
      expect(typeof taskWithOptionals.assignedWorker).toBe('string');
      expect(typeof taskWithOptionals.prUrl).toBe('string');
      expect(Array.isArray(taskWithOptionals.comments)).toBe(true);
      expect(taskWithOptionals.comments?.every(comment => typeof comment === 'string')).toBe(true);
    });

    it('should ensure readonly properties', () => {
      // Given: Task 객체가 있을 때
      const task: Task = {
        id: 'task-3',
        title: 'Readonly test',
        description: 'Test readonly properties',
        status: TaskStatus.TODO,
        priority: TaskPriority.LOW,
        projectId: 'project-1',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // When & Then: readonly 속성들은 타입 레벨에서 변경이 불가능해야 함
      // TypeScript 컴파일러가 이를 확인함
      expect(() => {
        // @ts-expect-error - readonly 속성은 변경할 수 없음
        task.id = 'new-id';
      }).toBeDefined();
    });
  });

  describe('TaskUpdate interface', () => {
    it('should allow partial updates with correct types', () => {
      // Given: TaskUpdate 인터페이스를 구현한 객체가 있을 때
      const taskUpdate: TaskUpdate = {
        status: TaskStatus.IN_PROGRESS,
        assignedWorker: 'worker-2'
      };

      // When: 각 속성을 확인하면
      // Then: 올바른 타입으로 존재해야 함
      expect(Object.values(TaskStatus)).toContain(taskUpdate.status);
      expect(typeof taskUpdate.assignedWorker).toBe('string');
    });

    it('should allow empty update object', () => {
      // Given: 빈 TaskUpdate 객체가 있을 때
      const emptyUpdate: TaskUpdate = {};

      // When & Then: 모든 속성이 선택적이므로 빈 객체도 유효해야 함
      expect(typeof emptyUpdate).toBe('object');
      expect(Object.keys(emptyUpdate)).toHaveLength(0);
    });

    it('should support all optional update fields', () => {
      // Given: 모든 선택적 필드를 포함한 TaskUpdate 객체가 있을 때
      const fullUpdate: TaskUpdate = {
        status: TaskStatus.DONE,
        assignedWorker: 'worker-3',
        prUrl: 'https://github.com/test/test/pull/2',
        comments: ['review comment 1', 'review comment 2']
      };

      // When: 각 속성을 확인하면
      // Then: 올바른 타입으로 존재해야 함
      expect(Object.values(TaskStatus)).toContain(fullUpdate.status);
      expect(typeof fullUpdate.assignedWorker).toBe('string');
      expect(typeof fullUpdate.prUrl).toBe('string');
      expect(Array.isArray(fullUpdate.comments)).toBe(true);
      expect(fullUpdate.comments?.every(comment => typeof comment === 'string')).toBe(true);
    });
  });
});
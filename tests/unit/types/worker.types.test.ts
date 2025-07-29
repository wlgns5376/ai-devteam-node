import { WorkerStatus, Worker, WorkerPool, WorkerUpdate } from '@/types/worker.types';

describe('Worker Types', () => {
  describe('WorkerStatus enum', () => {
    it('should contain all required worker states', () => {
      // Given: WorkerStatus enum이 정의되어 있을 때
      // When: 모든 상태 값들을 확인하면
      // Then: 필요한 모든 상태가 존재해야 함
      expect(WorkerStatus.IDLE).toBe('idle');
      expect(WorkerStatus.WAITING).toBe('waiting');
      expect(WorkerStatus.WORKING).toBe('working');
      expect(WorkerStatus.STOPPED).toBe('stopped');
    });

    it('should have exactly 4 worker status values', () => {
      // Given: WorkerStatus enum이 정의되어 있을 때
      // When: enum의 값 개수를 확인하면
      // Then: 정확히 4개의 상태만 존재해야 함
      const statusValues = Object.values(WorkerStatus);
      expect(statusValues).toHaveLength(4);
    });
  });

  describe('Worker interface', () => {
    it('should have all required properties with correct types', () => {
      // Given: Worker 인터페이스를 구현한 객체가 있을 때
      const mockWorker: Worker = {
        id: 'worker-1',
        status: WorkerStatus.IDLE,
        workspaceDir: '/workspace/worker-1',
        developerType: 'claude',
        createdAt: new Date('2024-01-01'),
        lastActiveAt: new Date('2024-01-01')
      };

      // When: 각 속성을 확인하면
      // Then: 모든 필수 속성이 올바른 타입으로 존재해야 함
      expect(typeof mockWorker.id).toBe('string');
      expect(Object.values(WorkerStatus)).toContain(mockWorker.status);
      expect(typeof mockWorker.workspaceDir).toBe('string');
      expect(['claude', 'gemini']).toContain(mockWorker.developerType);
      expect(mockWorker.createdAt).toBeInstanceOf(Date);
      expect(mockWorker.lastActiveAt).toBeInstanceOf(Date);
    });

    it('should support optional currentTask property', () => {
      // Given: currentTask를 포함한 Worker 객체가 있을 때
      const workerWithTask: Worker = {
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
      };

      // When: currentTask를 확인하면
      // Then: 올바른 타입으로 존재해야 함
      expect(typeof workerWithTask.currentTask?.taskId).toBe('string');
      expect(workerWithTask.currentTask?.action).toBe('start_new_task');
    });

    it('should support both developer types', () => {
      // Given: 다른 개발자 타입의 Worker 객체들이 있을 때
      const claudeWorker: Worker = {
        id: 'claude-worker',
        status: WorkerStatus.IDLE,
        workspaceDir: '/workspace/claude',
        developerType: 'claude',
        createdAt: new Date(),
        lastActiveAt: new Date()
      };

      const geminiWorker: Worker = {
        id: 'gemini-worker',
        status: WorkerStatus.IDLE,
        workspaceDir: '/workspace/gemini',
        developerType: 'gemini',
        createdAt: new Date(),
        lastActiveAt: new Date()
      };

      // When & Then: 두 타입 모두 유효해야 함
      expect(claudeWorker.developerType).toBe('claude');
      expect(geminiWorker.developerType).toBe('gemini');
    });

    it('should ensure readonly properties', () => {
      // Given: Worker 객체가 있을 때
      const worker: Worker = {
        id: 'worker-3',
        status: WorkerStatus.IDLE,
        workspaceDir: '/workspace/worker-3',
        developerType: 'claude',
        createdAt: new Date(),
        lastActiveAt: new Date()
      };

      // When & Then: readonly 속성들은 타입 레벨에서 변경이 불가능해야 함
      expect(() => {
        // @ts-expect-error - readonly 속성은 변경할 수 없음
        worker.id = 'new-id';
      }).toBeDefined();
    });
  });

  describe('WorkerPool interface', () => {
    it('should have all required properties with correct types', () => {
      // Given: WorkerPool 인터페이스를 구현한 객체가 있을 때
      const mockWorkerPool: WorkerPool = {
        workers: [
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
        ],
        minWorkers: 1,
        maxWorkers: 5,
        activeWorkers: 2
      };

      // When: 각 속성을 확인하면
      // Then: 올바른 타입으로 존재해야 함
      expect(Array.isArray(mockWorkerPool.workers)).toBe(true);
      expect(typeof mockWorkerPool.minWorkers).toBe('number');
      expect(typeof mockWorkerPool.maxWorkers).toBe('number');
      expect(typeof mockWorkerPool.activeWorkers).toBe('number');
      expect(mockWorkerPool.workers.length).toBe(2);
    });

    it('should validate worker pool constraints', () => {
      // Given: WorkerPool 객체가 있을 때
      const workerPool: WorkerPool = {
        workers: [],
        minWorkers: 1,
        maxWorkers: 5,
        activeWorkers: 0
      };

      // When: 제약 조건을 확인하면
      // Then: 논리적으로 유효한 값들이어야 함
      expect(workerPool.minWorkers).toBeLessThanOrEqual(workerPool.maxWorkers);
      expect(workerPool.activeWorkers).toBeGreaterThanOrEqual(0);
      expect(workerPool.activeWorkers).toBeLessThanOrEqual(workerPool.workers.length);
    });

    it('should ensure readonly workers array', () => {
      // Given: WorkerPool 객체가 있을 때
      const workerPool: WorkerPool = {
        workers: [],
        minWorkers: 1,
        maxWorkers: 5,
        activeWorkers: 0
      };

      // When & Then: workers 배열이 readonly여야 함
      expect(() => {
        // @ts-expect-error - readonly 배열은 변경할 수 없음
        workerPool.workers.push({} as Worker);
      }).toBeDefined();
    });
  });

  describe('WorkerUpdate interface', () => {
    it('should allow partial updates with correct types', () => {
      // Given: WorkerUpdate 인터페이스를 구현한 객체가 있을 때
      const workerUpdate: WorkerUpdate = {
        status: WorkerStatus.WORKING,
        currentTask: {
          taskId: 'task-2',
          action: 'start_new_task' as any,
          assignedAt: new Date(),
          repositoryId: 'test/repo'
        }
      };

      // When: 각 속성을 확인하면
      // Then: 올바른 타입으로 존재해야 함
      expect(Object.values(WorkerStatus)).toContain(workerUpdate.status);
      expect(typeof workerUpdate.currentTask?.taskId).toBe('string');
    });

    it('should allow empty update object', () => {
      // Given: 빈 WorkerUpdate 객체가 있을 때
      const emptyUpdate: WorkerUpdate = {};

      // When & Then: 모든 속성이 선택적이므로 빈 객체도 유효해야 함
      expect(typeof emptyUpdate).toBe('object');
      expect(Object.keys(emptyUpdate)).toHaveLength(0);
    });

    it('should support all optional update fields', () => {
      // Given: 모든 선택적 필드를 포함한 WorkerUpdate 객체가 있을 때
      const fullUpdate: WorkerUpdate = {
        status: WorkerStatus.STOPPED,
        currentTask: {
          taskId: 'task-3',
          action: 'start_new_task' as any,
          assignedAt: new Date(),
          repositoryId: 'test/repo'
        },
        lastActiveAt: new Date()
      };

      // When: 각 속성을 확인하면
      // Then: 올바른 타입으로 존재해야 함
      expect(Object.values(WorkerStatus)).toContain(fullUpdate.status);
      expect(typeof fullUpdate.currentTask?.taskId).toBe('string');
      expect(fullUpdate.lastActiveAt).toBeInstanceOf(Date);
    });

    it('should allow clearing currentTask', () => {
      // Given: currentTask를 undefined로 설정한 WorkerUpdate 객체가 있을 때
      const clearTaskUpdate: WorkerUpdate = {
        status: WorkerStatus.IDLE,
        currentTask: undefined
      };

      // When & Then: undefined 값도 유효해야 함
      expect(clearTaskUpdate.currentTask).toBeUndefined();
    });
  });
});
import { Worker } from '@/services/worker/worker';
import { WorkerStatus, WorkerAction, WorkerTask } from '@/types';
import { Logger } from '@/services/logger';

describe('Worker Error Recovery', () => {
  let worker: Worker;
  let mockDependencies: any;
  let mockTask: WorkerTask;

  beforeEach(() => {
    // Mock dependencies 설정
    mockDependencies = {
      logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
      } as unknown as Logger,
      workspaceSetup: {
        prepareWorkspace: jest.fn(),
        cleanupWorkspace: jest.fn()
      },
      promptGenerator: {
        generateFeedbackPrompt: jest.fn()
      },
      resultProcessor: {
        processOutput: jest.fn()
      },
      developer: {
        initialize: jest.fn(),
        executePrompt: jest.fn()
      }
    };

    // Worker 인스턴스 생성 (WAITING 상태로 초기화)
    worker = new Worker(
      'worker-1',
      '/workspace/worker-1',
      'claude',
      mockDependencies,
      WorkerStatus.WAITING
    );

    // Mock 작업 생성
    mockTask = {
      taskId: 'task-1',
      action: WorkerAction.PROCESS_FEEDBACK,
      repositoryId: 'test-owner/test-repo',
      assignedAt: new Date(),
      comments: [
        { id: 'comment-1', body: 'Please fix this issue' }
      ]
    };
  });

  describe('피드백 처리 중 에러 발생', () => {
    it('피드백 처리 중 에러 발생 시 ERROR 상태로 변경되어야 함', async () => {
      // Given: Worker에 피드백 작업 할당
      await worker.assignTask(mockTask);
      expect(worker.getStatus()).toBe(WorkerStatus.WAITING);

      // Mock 실행 중 에러 발생 설정
      mockDependencies.workspaceSetup.prepareWorkspace.mockRejectedValue(
        new Error('Workspace preparation failed')
      );

      // When: 작업 실행 시 에러 발생
      await expect(worker.startExecution()).rejects.toThrow(
        'Failed to execute task task-1: Workspace preparation failed'
      );

      // Then: Worker 상태가 ERROR로 변경되어야 함
      expect(worker.getStatus()).toBe(WorkerStatus.ERROR);
      
      // 작업 정보는 유지되어야 함
      expect(worker.getCurrentTask()).toEqual(mockTask);
      
      // 경고 로그가 출력되어야 함
      expect(mockDependencies.logger.warn).toHaveBeenCalledWith(
        'Worker marked as ERROR for retry',
        expect.objectContaining({
          workerId: 'worker-1',
          taskId: 'task-1',
          action: WorkerAction.PROCESS_FEEDBACK,
          willRetry: true
        })
      );
    });

    it('다른 작업 중 에러 발생 시 IDLE 상태로 초기화되어야 함', async () => {
      // Given: 새 작업으로 변경
      const newTask = {
        ...mockTask,
        action: WorkerAction.START_NEW_TASK
      };
      
      worker = new Worker(
        'worker-2',
        '/workspace/worker-2',
        'claude',
        mockDependencies,
        WorkerStatus.IDLE
      );
      
      await worker.assignTask(newTask);
      expect(worker.getStatus()).toBe(WorkerStatus.WAITING);

      // Mock 실행 중 에러 발생 설정
      mockDependencies.workspaceSetup.prepareWorkspace.mockRejectedValue(
        new Error('Workspace preparation failed')
      );

      // When: 작업 실행 시 에러 발생
      await expect(worker.startExecution()).rejects.toThrow(
        'Failed to execute task task-1: Workspace preparation failed'
      );

      // Then: Worker 상태가 IDLE로 초기화되어야 함
      expect(worker.getStatus()).toBe(WorkerStatus.IDLE);
      
      // 작업 정보는 초기화되어야 함
      expect(worker.getCurrentTask()).toBeNull();
    });

    it('ERROR 상태의 Worker는 resumeExecution으로 WAITING 상태로 복구 가능해야 함', async () => {
      // Given: ERROR 상태의 Worker
      await worker.assignTask(mockTask);
      mockDependencies.workspaceSetup.prepareWorkspace.mockRejectedValue(
        new Error('Temporary error')
      );
      
      await expect(worker.startExecution()).rejects.toThrow();
      expect(worker.getStatus()).toBe(WorkerStatus.ERROR);

      // When: resumeExecution 호출
      await worker.resumeExecution();

      // Then: WAITING 상태로 복구되어야 함
      expect(worker.getStatus()).toBe(WorkerStatus.WAITING);
      
      // 작업 정보는 유지되어야 함
      expect(worker.getCurrentTask()).toEqual(mockTask);
    });
  });

  describe('Developer 초기화 재시도', () => {
    it('Developer 초기화 실패 시 최대 3회까지 재시도해야 함', async () => {
      // Given: Developer 초기화가 2번 실패 후 성공하도록 설정
      let initCallCount = 0;
      mockDependencies.developer.initialize.mockImplementation(() => {
        initCallCount++;
        if (initCallCount < 3) {
          return Promise.reject(new Error('Init failed'));
        }
        return Promise.resolve();
      });

      // 나머지 mock 설정
      mockDependencies.workspaceSetup.prepareWorkspace.mockResolvedValue({
        workspaceDir: '/workspace'
      });
      mockDependencies.promptGenerator.generateFeedbackPrompt.mockResolvedValue('prompt');
      mockDependencies.developer.executePrompt.mockResolvedValue({
        rawOutput: 'output'
      });
      mockDependencies.resultProcessor.processOutput.mockResolvedValue({
        taskId: 'task-1',
        success: true,
        completedAt: new Date()
      });

      // When: 작업 실행
      await worker.assignTask(mockTask);
      const result = await worker.startExecution();

      // Then: 초기화가 3번 시도되어야 함
      expect(mockDependencies.developer.initialize).toHaveBeenCalledTimes(3);
      
      // 작업은 성공해야 함
      expect(result.success).toBe(true);
      
      // 경고 로그가 2번 출력되어야 함
      expect(mockDependencies.logger.warn).toHaveBeenCalledTimes(2);
    });

    it('Developer 초기화가 3회 모두 실패하면 에러를 던져야 함', async () => {
      // Given: Developer 초기화가 항상 실패하도록 설정
      mockDependencies.developer.initialize.mockRejectedValue(
        new Error('Persistent init failure')
      );

      // When: 작업 실행
      await worker.assignTask(mockTask);
      
      // Then: 에러가 발생해야 함
      await expect(worker.startExecution()).rejects.toThrow(
        'Failed to execute task task-1: Persistent init failure'
      );

      // 초기화가 3번 시도되어야 함
      expect(mockDependencies.developer.initialize).toHaveBeenCalledTimes(3);
      
      // 에러 로그가 출력되어야 함
      expect(mockDependencies.logger.error).toHaveBeenCalledWith(
        'Developer initialization failed after all retries',
        expect.objectContaining({
          workerId: 'worker-1',
          developerType: 'claude',
          maxRetries: 3
        })
      );
    });
  });
});
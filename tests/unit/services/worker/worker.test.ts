import { Worker } from '@/services/worker/worker';
import { Logger } from '@/services/logger';
import { 
  WorkerTask,
  WorkerAction,
  WorkerStatus,
  WorkerStage,
  WorkerInterface,
  WorkerProgress,
  WorkerResult,
  WorkspaceSetupInterface,
  PromptGeneratorInterface,
  ResultProcessorInterface,
  DeveloperInterface,
  WorkspaceInfo
} from '@/types';

// Mock interfaces
interface MockWorkspaceSetup extends WorkspaceSetupInterface {
  prepareWorkspace: jest.Mock;
  validateEnvironment: jest.Mock;
  cleanupWorkspace: jest.Mock;
}

interface MockPromptGenerator extends PromptGeneratorInterface {
  generateNewTaskPrompt: jest.Mock;
  generateResumePrompt: jest.Mock;
  generateFeedbackPrompt: jest.Mock;
  generateMergePrompt: jest.Mock;
}

interface MockResultProcessor extends ResultProcessorInterface {
  processOutput: jest.Mock;
  extractPullRequestUrl: jest.Mock;
  extractErrorInfo: jest.Mock;
  generateStatusReport: jest.Mock;
}

interface MockDeveloper extends DeveloperInterface {
  readonly type: any;
  initialize: jest.Mock;
  executePrompt: jest.Mock;
  cleanup: jest.Mock;
  isAvailable: jest.Mock;
  setTimeout: jest.Mock;
}

describe('Worker', () => {
  let worker: Worker;
  let mockLogger: jest.Mocked<Logger>;
  let mockWorkspaceSetup: MockWorkspaceSetup;
  let mockPromptGenerator: MockPromptGenerator;
  let mockResultProcessor: MockResultProcessor;
  let mockDeveloper: MockDeveloper;

  beforeEach(() => {
    // Given: Mock 의존성 설정
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    mockWorkspaceSetup = {
      prepareWorkspace: jest.fn(),
      validateEnvironment: jest.fn(),
      cleanupWorkspace: jest.fn()
    };

    mockPromptGenerator = {
      generateNewTaskPrompt: jest.fn(),
      generateResumePrompt: jest.fn(),
      generateFeedbackPrompt: jest.fn(),
      generateMergePrompt: jest.fn()
    };

    mockResultProcessor = {
      processOutput: jest.fn(),
      extractPullRequestUrl: jest.fn(),
      extractErrorInfo: jest.fn(),
      generateStatusReport: jest.fn()
    };

    mockDeveloper = {
      type: 'mock',
      initialize: jest.fn(),
      executePrompt: jest.fn(),
      cleanup: jest.fn(),
      isAvailable: jest.fn(),
      setTimeout: jest.fn()
    };

    worker = new Worker('worker-123', '/workspace/worker-123', 'claude', {
      logger: mockLogger,
      workspaceSetup: mockWorkspaceSetup,
      promptGenerator: mockPromptGenerator,
      resultProcessor: mockResultProcessor,
      developer: mockDeveloper
    });
  });

  describe('초기화', () => {
    it('Worker가 올바르게 초기화되어야 한다', () => {
      // Then: 초기 상태 확인
      expect(worker.getStatus()).toBe(WorkerStatus.IDLE);
      expect(worker.getCurrentTask()).toBeNull();
      expect(worker.getProgress()).toBeNull();
    });

    it('Worker ID와 정보를 올바르게 설정해야 한다', () => {
      // Then: Worker 정보 확인
      expect(worker.id).toBe('worker-123');
      expect(worker.workspaceDir).toBe('/workspace/worker-123');
      expect(worker.developerType).toBe('claude');
      expect(worker.status).toBe(WorkerStatus.IDLE);
      expect(worker.createdAt).toBeInstanceOf(Date);
      expect(worker.lastActiveAt).toBeInstanceOf(Date);
    });
  });

  describe('작업 할당', () => {
    it('새로운 작업을 할당할 수 있어야 한다', async () => {
      // Given: 새 작업
      const task: WorkerTask = {
        taskId: 'task-123',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        boardItem: {
          id: 'task-123',
          title: 'Implement feature'
        }
      };

      // When: 작업 할당
      await worker.assignTask(task);

      // Then: 작업이 할당됨
      expect(worker.getCurrentTask()).toEqual(task);
      expect(worker.getStatus()).toBe(WorkerStatus.WAITING);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Task assigned to worker',
        { workerId: worker.id, taskId: task.taskId, action: task.action }
      );
    });

    it('이미 작업 중인 Worker에는 작업을 할당할 수 없어야 한다', async () => {
      // Given: 이미 작업 중인 Worker
      const task1: WorkerTask = {
        taskId: 'task-1',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      const task2: WorkerTask = {
        taskId: 'task-2',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      await worker.assignTask(task1);

      // When & Then: 두 번째 작업 할당 실패
      await expect(worker.assignTask(task2)).rejects.toThrow(
        'Worker is already assigned to a task'
      );
    });
  });

  describe('작업 실행', () => {
    let task: WorkerTask;
    let workspaceInfo: WorkspaceInfo;

    beforeEach(() => {
      task = {
        taskId: 'task-execute',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        boardItem: {
          id: 'task-execute',
          title: 'Execute task'
        }
      };

      workspaceInfo = {
        taskId: 'task-execute',
        repositoryId: 'owner/repo',
        workspaceDir: '/workspace/owner_repo_task-execute',
        branchName: 'task-execute',
        worktreeCreated: true,
        claudeLocalPath: '/workspace/owner_repo_task-execute/CLAUDE.local.md',
        createdAt: new Date()
      };
    });

    it('성공적인 작업 실행을 완료한 후 리뷰 대기 상태가 되어야 한다', async () => {
      // Given: 성공적인 실행을 위한 Mock 설정
      await worker.assignTask(task);
      
      mockWorkspaceSetup.prepareWorkspace.mockResolvedValue(workspaceInfo);
      mockPromptGenerator.generateNewTaskPrompt.mockResolvedValue('Generated prompt');
      mockDeveloper.executePrompt.mockResolvedValue({
        rawOutput: 'Task completed successfully\nPR: https://github.com/owner/repo/pull/123',
        result: { success: true, prLink: 'https://github.com/owner/repo/pull/123' },
        executedCommands: [],
        modifiedFiles: [],
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          duration: 1000,
          developerType: 'mock' as const
        }
      });
      
      const expectedResult: WorkerResult = {
        taskId: task.taskId,
        success: true,
        pullRequestUrl: 'https://github.com/owner/repo/pull/123',
        completedAt: new Date()
      };
      
      mockResultProcessor.processOutput.mockResolvedValue(expectedResult);

      // When: 작업 실행
      const result = await worker.startExecution();

      // Then: PR 생성 완료 후 리뷰 대기 상태
      expect(result).toEqual(expectedResult);
      expect(worker.getStatus()).toBe(WorkerStatus.WAITING); // PR 생성 완료, 리뷰 대기 중
      expect(worker.getCurrentTask()).toEqual(task); // 워크플로우 완료까지 task 유지
      
      // 각 단계별 호출 확인
      expect(mockWorkspaceSetup.prepareWorkspace).toHaveBeenCalledWith(task);
      expect(mockPromptGenerator.generateNewTaskPrompt).toHaveBeenCalledWith(task, workspaceInfo);
      expect(mockDeveloper.executePrompt).toHaveBeenCalledWith(
        'Generated prompt',
        workspaceInfo.workspaceDir
      );
      expect(mockResultProcessor.processOutput).toHaveBeenCalledWith(
        'Task completed successfully\nPR: https://github.com/owner/repo/pull/123',
        task
      );
    });

    it('워크스페이스 준비 실패 시 적절히 처리해야 한다', async () => {
      // Given: 워크스페이스 준비 실패
      await worker.assignTask(task);
      
      const error = new Error('Workspace preparation failed');
      mockWorkspaceSetup.prepareWorkspace.mockRejectedValue(error);

      // When & Then: 실행 실패
      await expect(worker.startExecution()).rejects.toThrow(
        'Failed to execute task task-execute: Workspace preparation failed'
      );
      
      expect(worker.getStatus()).toBe(WorkerStatus.IDLE);
      expect(worker.getCurrentTask()).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Task execution failed',
        { workerId: worker.id, taskId: task.taskId, action: task.action, stage: WorkerStage.PREPARING_WORKSPACE, error }
      );
    });

    it('Developer 실행 실패 시 적절히 처리해야 한다', async () => {
      // Given: Developer 실행 실패
      await worker.assignTask(task);
      
      mockWorkspaceSetup.prepareWorkspace.mockResolvedValue(workspaceInfo);
      mockPromptGenerator.generateNewTaskPrompt.mockResolvedValue('Generated prompt');
      
      const error = new Error('Developer execution failed');
      mockDeveloper.executePrompt.mockRejectedValue(error);

      // When & Then: 실행 실패
      await expect(worker.startExecution()).rejects.toThrow(
        'Failed to execute task task-execute: Developer execution failed'
      );
      
      expect(worker.getStatus()).toBe(WorkerStatus.IDLE);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Task execution failed',
        { workerId: worker.id, taskId: task.taskId, action: task.action, stage: WorkerStage.EXECUTING_TASK, error }
      );
    });
  });

  describe('다양한 작업 유형', () => {
    it('재개 작업을 처리할 수 있어야 한다', async () => {
      // Given: 먼저 새 작업을 할당하여 WAITING 상태로 만든 후 재개 작업으로 전환
      const initialTask: WorkerTask = {
        taskId: 'task-resume',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      const resumeTask: WorkerTask = {
        taskId: 'task-resume',
        action: WorkerAction.RESUME_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      const workspaceInfo: WorkspaceInfo = {
        taskId: 'task-resume',
        repositoryId: 'owner/repo',
        workspaceDir: '/workspace/owner_repo_task-resume',
        branchName: 'task-resume',
        worktreeCreated: true,
        claudeLocalPath: '/workspace/owner_repo_task-resume/CLAUDE.local.md',
        createdAt: new Date()
      };

      // 먼저 새 작업으로 할당하여 WAITING 상태로 만듦
      await worker.assignTask(initialTask);
      // 그 다음 재개 작업으로 변경
      await worker.assignTask(resumeTask);
      
      mockWorkspaceSetup.prepareWorkspace.mockResolvedValue(workspaceInfo);
      mockPromptGenerator.generateResumePrompt.mockResolvedValue('Resume prompt');
      mockDeveloper.executePrompt.mockResolvedValue({
        rawOutput: 'Task resumed and completed',
        result: { success: true },
        executedCommands: [],
        modifiedFiles: [],
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          duration: 1000,
          developerType: 'mock' as const
        }
      });
      
      const expectedResult: WorkerResult = {
        taskId: resumeTask.taskId,
        success: true,
        completedAt: new Date()
      };
      
      mockResultProcessor.processOutput.mockResolvedValue(expectedResult);

      // When: 재개 작업 실행
      const result = await worker.startExecution();

      // Then: 재개 프롬프트 사용
      expect(mockPromptGenerator.generateResumePrompt).toHaveBeenCalledWith(resumeTask, workspaceInfo);
      expect(result).toEqual(expectedResult);
    });

    it('피드백 처리 작업을 처리할 수 있어야 한다', async () => {
      // Given: 먼저 새 작업을 할당하여 WAITING 상태로 만든 후 피드백 처리 작업으로 전환
      const initialTask: WorkerTask = {
        taskId: 'task-feedback',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      const feedbackTask: WorkerTask = {
        taskId: 'task-feedback',
        action: WorkerAction.PROCESS_FEEDBACK,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        comments: [
          { id: 'comment-1', body: 'Fix this issue', author: 'reviewer' }
        ]
      };

      // 먼저 새 작업으로 할당하여 WAITING 상태로 만듦
      await worker.assignTask(initialTask);
      // 그 다음 피드백 처리 작업으로 변경
      await worker.assignTask(feedbackTask);
      
      mockWorkspaceSetup.prepareWorkspace.mockResolvedValue({} as WorkspaceInfo);
      mockPromptGenerator.generateFeedbackPrompt.mockResolvedValue('Feedback prompt');
      mockDeveloper.executePrompt.mockResolvedValue({
        rawOutput: 'Feedback processed',
        result: { success: true },
        executedCommands: [],
        modifiedFiles: [],
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          duration: 1000,
          developerType: 'mock' as const
        }
      });
      
      const expectedResult: WorkerResult = {
        taskId: feedbackTask.taskId,
        success: true,
        completedAt: new Date()
      };
      
      mockResultProcessor.processOutput.mockResolvedValue(expectedResult);

      // When: 피드백 작업 실행
      await worker.startExecution();

      // Then: 피드백 프롬프트 사용
      expect(mockPromptGenerator.generateFeedbackPrompt).toHaveBeenCalledWith(
        feedbackTask, 
        feedbackTask.comments
      );
    });

    it('병합 작업 성공 시 워크스페이스를 정리해야 한다', async () => {
      // Given: 먼저 새 작업을 할당하여 WAITING 상태로 만든 후 병합 작업으로 전환
      const initialTask: WorkerTask = {
        taskId: 'task-merge',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      const mergeTask: WorkerTask = {
        taskId: 'task-merge',
        action: WorkerAction.MERGE_REQUEST,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        pullRequestUrl: 'https://github.com/owner/repo/pull/123'
      };

      const workspaceInfo: WorkspaceInfo = {
        taskId: 'task-merge',
        repositoryId: 'owner/repo',
        workspaceDir: '/workspace/owner_repo_task-merge',
        branchName: 'task-merge',
        worktreeCreated: true,
        claudeLocalPath: '/workspace/owner_repo_task-merge/CLAUDE.local.md',
        createdAt: new Date()
      };

      // 먼저 새 작업으로 할당하여 WAITING 상태로 만듦
      await worker.assignTask(initialTask);
      // 그 다음 병합 작업으로 변경
      await worker.assignTask(mergeTask);
      
      mockWorkspaceSetup.prepareWorkspace.mockResolvedValue(workspaceInfo);
      mockPromptGenerator.generateMergePrompt.mockResolvedValue('Merge prompt');
      mockDeveloper.executePrompt.mockResolvedValue({
        rawOutput: 'Merge completed successfully',
        result: { success: true },
        executedCommands: [],
        modifiedFiles: [],
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          duration: 1000,
          developerType: 'mock' as const
        }
      });
      
      const expectedResult: WorkerResult = {
        taskId: mergeTask.taskId,
        success: true,
        completedAt: new Date()
      };
      
      mockResultProcessor.processOutput.mockResolvedValue(expectedResult);
      mockWorkspaceSetup.cleanupWorkspace.mockResolvedValue(undefined);

      // When: 병합 작업 실행
      const result = await worker.startExecution();

      // Then: 병합 성공 후 워크스페이스 정리 실행
      expect(result).toEqual(expectedResult);
      expect(mockPromptGenerator.generateMergePrompt).toHaveBeenCalledWith(mergeTask);
      expect(mockWorkspaceSetup.cleanupWorkspace).toHaveBeenCalledWith(mergeTask.taskId);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cleaning up workspace after successful merge',
        { workerId: worker.id, taskId: mergeTask.taskId }
      );
    });

    it('병합 작업 실패 시 워크스페이스 정리를 하지 않아야 한다', async () => {
      // Given: 먼저 새 작업을 할당하여 WAITING 상태로 만든 후 병합 작업으로 전환 (실패 케이스)
      const initialTask: WorkerTask = {
        taskId: 'task-merge-fail',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      const mergeTask: WorkerTask = {
        taskId: 'task-merge-fail',
        action: WorkerAction.MERGE_REQUEST,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        pullRequestUrl: 'https://github.com/owner/repo/pull/124'
      };

      const workspaceInfo: WorkspaceInfo = {
        taskId: 'task-merge-fail',
        repositoryId: 'owner/repo',
        workspaceDir: '/workspace/owner_repo_task-merge-fail',
        branchName: 'task-merge-fail',
        worktreeCreated: true,
        claudeLocalPath: '/workspace/owner_repo_task-merge-fail/CLAUDE.local.md',
        createdAt: new Date()
      };

      // 먼저 새 작업으로 할당하여 WAITING 상태로 만듦
      await worker.assignTask(initialTask);
      // 그 다음 병합 작업으로 변경
      await worker.assignTask(mergeTask);
      
      mockWorkspaceSetup.prepareWorkspace.mockResolvedValue(workspaceInfo);
      mockPromptGenerator.generateMergePrompt.mockResolvedValue('Merge prompt');
      mockDeveloper.executePrompt.mockResolvedValue({
        rawOutput: 'Merge failed',
        result: { success: false },
        executedCommands: [],
        modifiedFiles: [],
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          duration: 1000,
          developerType: 'mock' as const
        }
      });
      
      const expectedResult: WorkerResult = {
        taskId: mergeTask.taskId,
        success: false,
        completedAt: new Date()
      };
      
      mockResultProcessor.processOutput.mockResolvedValue(expectedResult);

      // When: 병합 작업 실행 (실패)
      const result = await worker.startExecution();

      // Then: 병합 실패 시 워크스페이스 정리를 하지 않음
      expect(result).toEqual(expectedResult);
      expect(mockWorkspaceSetup.cleanupWorkspace).not.toHaveBeenCalled();
    });

    it('병합 작업 성공 후 워크스페이스 정리 실패 시 경고 로그를 남겨야 한다', async () => {
      // Given: 먼저 새 작업을 할당하여 WAITING 상태로 만든 후 병합 작업으로 전환 (정리 실패 케이스)
      const initialTask: WorkerTask = {
        taskId: 'task-merge-cleanup-fail',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      const mergeTask: WorkerTask = {
        taskId: 'task-merge-cleanup-fail',
        action: WorkerAction.MERGE_REQUEST,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        pullRequestUrl: 'https://github.com/owner/repo/pull/125'
      };

      const workspaceInfo: WorkspaceInfo = {
        taskId: 'task-merge-cleanup-fail',
        repositoryId: 'owner/repo',
        workspaceDir: '/workspace/owner_repo_task-merge-cleanup-fail',
        branchName: 'task-merge-cleanup-fail',
        worktreeCreated: true,
        claudeLocalPath: '/workspace/owner_repo_task-merge-cleanup-fail/CLAUDE.local.md',
        createdAt: new Date()
      };

      // 먼저 새 작업으로 할당하여 WAITING 상태로 만듦
      await worker.assignTask(initialTask);
      // 그 다음 병합 작업으로 변경
      await worker.assignTask(mergeTask);
      
      mockWorkspaceSetup.prepareWorkspace.mockResolvedValue(workspaceInfo);
      mockPromptGenerator.generateMergePrompt.mockResolvedValue('Merge prompt');
      mockDeveloper.executePrompt.mockResolvedValue({
        rawOutput: 'Merge completed successfully',
        result: { success: true },
        executedCommands: [],
        modifiedFiles: [],
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          duration: 1000,
          developerType: 'mock' as const
        }
      });
      
      const expectedResult: WorkerResult = {
        taskId: mergeTask.taskId,
        success: true,
        completedAt: new Date()
      };
      
      mockResultProcessor.processOutput.mockResolvedValue(expectedResult);
      
      const cleanupError = new Error('Cleanup failed');
      mockWorkspaceSetup.cleanupWorkspace.mockRejectedValue(cleanupError);

      // When: 병합 작업 실행 (정리 실패)
      const result = await worker.startExecution();

      // Then: 병합은 성공하고 정리 실패는 경고 로그로 처리
      expect(result).toEqual(expectedResult);
      expect(mockWorkspaceSetup.cleanupWorkspace).toHaveBeenCalledWith(mergeTask.taskId);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to cleanup workspace after merge',
        { 
          workerId: worker.id, 
          taskId: mergeTask.taskId, 
          error: cleanupError 
        }
      );
    });
  });

  describe('실행 제어', () => {
    it('실행을 일시 정지할 수 있어야 한다', async () => {
      // Given: 실행 중인 Worker
      const task: WorkerTask = {
        taskId: 'task-pause',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      await worker.assignTask(task);

      // When: 실행 일시 정지
      await worker.pauseExecution();

      // Then: 상태가 STOPPED로 변경
      expect(worker.getStatus()).toBe(WorkerStatus.STOPPED);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Worker execution paused',
        { workerId: worker.id, taskId: task.taskId }
      );
    });

    it('일시 정지된 실행을 재개할 수 있어야 한다', async () => {
      // Given: 일시 정지된 Worker
      const task: WorkerTask = {
        taskId: 'task-resume-exec',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      await worker.assignTask(task);
      await worker.pauseExecution();

      // When: 실행 재개
      await worker.resumeExecution();

      // Then: 상태가 WAITING으로 변경
      expect(worker.getStatus()).toBe(WorkerStatus.WAITING);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Worker execution resumed',
        { workerId: worker.id, taskId: task.taskId, previousStatus: 'stopped' }
      );
    });

    it('실행을 취소할 수 있어야 한다', async () => {
      // Given: 실행 중인 Worker
      const task: WorkerTask = {
        taskId: 'task-cancel',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      await worker.assignTask(task);

      // When: 실행 취소
      await worker.cancelExecution();

      // Then: 상태 초기화
      expect(worker.getStatus()).toBe(WorkerStatus.IDLE);
      expect(worker.getCurrentTask()).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Worker execution cancelled',
        { workerId: worker.id, taskId: task.taskId }
      );
    });
  });

  describe('진행 상황 추적', () => {
    it('작업 진행 상황을 추적해야 한다', async () => {
      // Given: 할당된 작업
      const task: WorkerTask = {
        taskId: 'task-progress',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      await worker.assignTask(task);

      // When: 진행 상황 확인
      const progress = worker.getProgress();

      // Then: 진행 상황 반환
      expect(progress).toEqual({
        taskId: task.taskId,
        stage: WorkerStage.PREPARING_WORKSPACE,
        message: '작업 준비 중',
        timestamp: expect.any(Date)
      });
    });
  });

  describe('정리', () => {
    it('Worker를 정리할 수 있어야 한다', async () => {
      // Given: 작업이 할당된 Worker
      const task: WorkerTask = {
        taskId: 'task-cleanup',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      await worker.assignTask(task);
      mockWorkspaceSetup.cleanupWorkspace.mockResolvedValue(undefined);

      // When: 정리 실행
      await worker.cleanup();

      // Then: 상태 초기화 및 워크스페이스 정리
      expect(worker.getStatus()).toBe(WorkerStatus.IDLE);
      expect(worker.getCurrentTask()).toBeNull();
      expect(mockWorkspaceSetup.cleanupWorkspace).toHaveBeenCalledWith(task.taskId);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Worker cleanup completed',
        { workerId: worker.id }
      );
    });

    it('정리 중 에러가 발생해도 안전하게 처리해야 한다', async () => {
      // Given: 작업이 할당된 상태에서 정리 중 에러 발생
      const task: WorkerTask = {
        taskId: 'task-cleanup-error',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      await worker.assignTask(task);
      
      const error = new Error('Cleanup failed');
      mockWorkspaceSetup.cleanupWorkspace.mockRejectedValue(error);

      // When: 정리 실행 (에러가 발생하지 않아야 함)
      await worker.cleanup();

      // Then: 에러 로그만 남기고 정상 처리
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Worker cleanup failed',
        { workerId: worker.id, error }
      );
    });
  });
});
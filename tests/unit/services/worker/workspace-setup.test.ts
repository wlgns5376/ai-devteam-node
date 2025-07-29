import { WorkspaceSetup } from '@/services/worker/workspace-setup';
import { Logger } from '@/services/logger';
import { 
  WorkerTask, 
  WorkerAction,
  WorkspaceSetupInterface,
  WorkspaceInfo
} from '@/types';

// Mock WorkspaceManager
interface MockWorkspaceManager {
  createWorkspace: jest.Mock;
  setupWorktree: jest.Mock;
  setupClaudeLocal: jest.Mock;
  cleanupWorkspace: jest.Mock;
  getWorkspaceInfo: jest.Mock;
}

describe('WorkspaceSetup', () => {
  let workspaceSetup: WorkspaceSetup;
  let mockLogger: jest.Mocked<Logger>;
  let mockWorkspaceManager: MockWorkspaceManager;

  beforeEach(() => {
    // Given: Mock 의존성 설정
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    mockWorkspaceManager = {
      createWorkspace: jest.fn(),
      setupWorktree: jest.fn(),
      setupClaudeLocal: jest.fn(),
      cleanupWorkspace: jest.fn(),
      getWorkspaceInfo: jest.fn()
    };

    workspaceSetup = new WorkspaceSetup({
      logger: mockLogger,
      workspaceManager: mockWorkspaceManager
    });
  });

  describe('워크스페이스 준비', () => {
    it('새 작업을 위한 워크스페이스를 준비해야 한다', async () => {
      // Given: 새 작업 정보
      const task: WorkerTask = {
        taskId: 'task-123',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        boardItem: {
          id: 'task-123',
          title: 'Test Task',
          description: 'Test Description'
        }
      };

      const expectedWorkspaceInfo: WorkspaceInfo = {
        taskId: 'task-123',
        repositoryId: 'owner/repo',
        workspaceDir: '/workspace/owner_repo_task-123',
        branchName: 'task-123',
        worktreeCreated: true,
        claudeLocalPath: '/workspace/owner_repo_task-123/CLAUDE.local.md',
        createdAt: new Date()
      };

      mockWorkspaceManager.createWorkspace.mockResolvedValue(expectedWorkspaceInfo);
      mockWorkspaceManager.setupWorktree.mockResolvedValue(undefined);
      mockWorkspaceManager.setupClaudeLocal.mockResolvedValue(undefined);

      // When: 워크스페이스 준비
      const result = await workspaceSetup.prepareWorkspace(task);

      // Then: 완전한 워크스페이스가 준비됨
      expect(mockWorkspaceManager.createWorkspace).toHaveBeenCalledWith(
        task.taskId,
        task.repositoryId,
        task.boardItem
      );
      expect(mockWorkspaceManager.setupWorktree).toHaveBeenCalledWith(expectedWorkspaceInfo);
      expect(mockWorkspaceManager.setupClaudeLocal).toHaveBeenCalledWith(expectedWorkspaceInfo);
      expect(result).toEqual(expectedWorkspaceInfo);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Workspace prepared successfully',
        { taskId: task.taskId, workspaceDir: expectedWorkspaceInfo.workspaceDir }
      );
    });

    it('기존 워크스페이스가 있으면 재사용해야 한다', async () => {
      // Given: 기존 워크스페이스가 있는 작업
      const task: WorkerTask = {
        taskId: 'task-existing',
        action: WorkerAction.RESUME_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      const existingWorkspaceInfo: WorkspaceInfo = {
        taskId: 'task-existing',
        repositoryId: 'owner/repo',
        workspaceDir: '/workspace/owner_repo_task-existing',
        branchName: 'task-existing',
        worktreeCreated: true,
        claudeLocalPath: '/workspace/owner_repo_task-existing/CLAUDE.local.md',
        createdAt: new Date()
      };

      mockWorkspaceManager.getWorkspaceInfo.mockResolvedValue(existingWorkspaceInfo);

      // When: 워크스페이스 준비
      const result = await workspaceSetup.prepareWorkspace(task);

      // Then: 기존 워크스페이스 재사용
      expect(mockWorkspaceManager.getWorkspaceInfo).toHaveBeenCalledWith(task.taskId);
      expect(mockWorkspaceManager.createWorkspace).not.toHaveBeenCalled();
      expect(result).toEqual(existingWorkspaceInfo);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Reusing existing workspace',
        { taskId: task.taskId, workspaceDir: existingWorkspaceInfo.workspaceDir }
      );
    });

    it('워크스페이스 준비 실패 시 적절한 에러를 발생시켜야 한다', async () => {
      // Given: 워크스페이스 생성 실패
      const task: WorkerTask = {
        taskId: 'task-fail',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      const error = new Error('Workspace creation failed');
      mockWorkspaceManager.createWorkspace.mockRejectedValue(error);

      // When & Then: 에러 발생
      await expect(workspaceSetup.prepareWorkspace(task)).rejects.toThrow(
        'Failed to prepare workspace for task task-fail: Workspace creation failed'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to prepare workspace',
        { taskId: task.taskId, error }
      );
    });
  });

  describe('환경 검증', () => {
    let workspaceInfo: WorkspaceInfo;

    beforeEach(() => {
      workspaceInfo = {
        taskId: 'task-123',
        repositoryId: 'owner/repo',
        workspaceDir: '/workspace/owner_repo_task-123',
        branchName: 'task-123',
        worktreeCreated: true,
        claudeLocalPath: '/workspace/owner_repo_task-123/CLAUDE.local.md',
        createdAt: new Date()
      };
    });

    it('워크스페이스 환경이 올바른지 검증해야 한다', async () => {
      // Given: Mock fs를 올바른 상태로 설정
      const fs = require('fs/promises');
      jest.spyOn(fs, 'access').mockResolvedValue(undefined);
      jest.spyOn(fs, 'stat').mockResolvedValue({
        isDirectory: () => true
      });

      // When: 환경 검증
      const isValid = await workspaceSetup.validateEnvironment(workspaceInfo);

      // Then: 유효함
      expect(isValid).toBe(true);
      expect(fs.access).toHaveBeenCalledWith(workspaceInfo.workspaceDir);
      expect(fs.access).toHaveBeenCalledWith(workspaceInfo.claudeLocalPath);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Workspace environment validation passed',
        { taskId: workspaceInfo.taskId }
      );
    });

    it('워크스페이스 디렉토리가 없으면 유효하지 않아야 한다', async () => {
      // Given: 워크스페이스 디렉토리가 없음
      const fs = require('fs/promises');
      jest.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));

      // When: 환경 검증
      const isValid = await workspaceSetup.validateEnvironment(workspaceInfo);

      // Then: 유효하지 않음
      expect(isValid).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Workspace environment validation failed',
        { taskId: workspaceInfo.taskId, reason: 'Directory or files missing' }
      );
    });

    it('CLAUDE.local.md 파일이 없으면 유효하지 않아야 한다', async () => {
      // Given: 워크스페이스는 있지만 CLAUDE.local.md가 없음
      const fs = require('fs/promises');
      jest.spyOn(fs, 'access')
        .mockResolvedValueOnce(undefined) // 워크스페이스 디렉토리 확인 성공
        .mockRejectedValueOnce(new Error('ENOENT')); // CLAUDE.local.md 확인 실패

      // When: 환경 검증
      const isValid = await workspaceSetup.validateEnvironment(workspaceInfo);

      // Then: 유효하지 않음
      expect(isValid).toBe(false);
    });
  });

  describe('정리', () => {
    it('작업 완료 후 워크스페이스를 정리해야 한다', async () => {
      // Given: 정리할 작업 ID
      const taskId = 'task-cleanup';
      mockWorkspaceManager.cleanupWorkspace.mockResolvedValue(undefined);

      // When: 워크스페이스 정리
      await workspaceSetup.cleanupWorkspace(taskId);

      // Then: 정리 완료
      expect(mockWorkspaceManager.cleanupWorkspace).toHaveBeenCalledWith(taskId);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Workspace cleanup completed',
        { taskId }
      );
    });

    it('에러 발생 시에도 안전하게 정리해야 한다', async () => {
      // Given: 정리 중 에러 발생
      const taskId = 'task-error';
      const error = new Error('Cleanup failed');
      mockWorkspaceManager.cleanupWorkspace.mockRejectedValue(error);

      // When: 워크스페이스 정리 (에러가 발생하지 않아야 함)
      await workspaceSetup.cleanupWorkspace(taskId);

      // Then: 에러 로그만 남기고 정상 처리
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to cleanup workspace',
        { taskId, error }
      );
    });
  });

  describe('입력 검증', () => {
    it('유효하지 않은 작업 정보는 거부해야 한다', async () => {
      // Given: 잘못된 작업 정보
      const invalidTask = {
        taskId: '',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      } as WorkerTask;

      // When & Then: 에러 발생
      await expect(workspaceSetup.prepareWorkspace(invalidTask)).rejects.toThrow(
        'Invalid task: taskId cannot be empty'
      );
    });

    it('저장소 ID가 없으면 거부해야 한다', async () => {
      // Given: 저장소 ID가 없는 작업
      const invalidTask = {
        taskId: 'task-123',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: '',
        assignedAt: new Date()
      } as WorkerTask;

      // When & Then: 에러 발생
      await expect(workspaceSetup.prepareWorkspace(invalidTask)).rejects.toThrow(
        'Invalid task: repositoryId cannot be empty'
      );
    });
  });
});
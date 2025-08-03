import { WorkspaceManager } from '@/services/manager/workspace-manager';
import { Logger } from '@/services/logger';
import { StateManager } from '@/services/state-manager';
import { 
  ManagerServiceConfig,
  GitServiceInterface,
  RepositoryManagerInterface,
  WorkspaceInfo
} from '@/types';
import fs from 'fs/promises';
import path from 'path';

describe('WorkspaceManager', () => {
  let workspaceManager: WorkspaceManager;
  let mockLogger: jest.Mocked<Logger>;
  let mockStateManager: jest.Mocked<StateManager>;
  let mockGitService: jest.Mocked<GitServiceInterface>;
  let mockRepositoryManager: jest.Mocked<RepositoryManagerInterface>;
  let config: ManagerServiceConfig;
  let tempWorkspaceDir: string;

  beforeEach(() => {
    // Given: Mock 의존성 설정
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    mockStateManager = {
      saveWorkspaceInfo: jest.fn(),
      loadWorkspaceInfo: jest.fn(),
      removeWorkspaceInfo: jest.fn()
    } as any;

    mockGitService = {
      clone: jest.fn(),
      fetch: jest.fn(),
      createWorktree: jest.fn(),
      removeWorktree: jest.fn(),
      isValidRepository: jest.fn()
    } as any;

    mockRepositoryManager = {
      ensureRepository: jest.fn(),
      cloneRepository: jest.fn(),
      fetchRepository: jest.fn(),
      getRepositoryState: jest.fn(),
      isRepositoryCloned: jest.fn(),
      addWorktree: jest.fn(),
      removeWorktree: jest.fn()
    } as any;

    tempWorkspaceDir = '/tmp/test-workspace';
    config = {
      workspaceBasePath: tempWorkspaceDir,
      minWorkers: 2,
      maxWorkers: 5,
      workerRecoveryTimeoutMs: 30000,
      gitOperationTimeoutMs: 60000,
      repositoryCacheTimeoutMs: 300000
    };

    workspaceManager = new WorkspaceManager(config, {
      logger: mockLogger,
      stateManager: mockStateManager,
      gitService: mockGitService,
      repositoryManager: mockRepositoryManager
    });
  });

  describe('Workspace 생성', () => {
    it('작업별 독립 디렉토리를 생성해야 한다', async () => {
      // Given: 작업 정보
      const taskId = 'task-123';
      const repositoryId = 'owner/repo';

      // Mock fs.mkdir
      jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
      jest.spyOn(fs, 'access').mockRejectedValue(new Error('Directory not exists'));

      // When: Workspace 생성
      const workspaceInfo = await workspaceManager.createWorkspace(taskId, repositoryId);

      // Then: 올바른 구조로 생성됨
      expect(workspaceInfo.taskId).toBe(taskId);
      expect(workspaceInfo.repositoryId).toBe(repositoryId);
      expect(workspaceInfo.workspaceDir).toBe(path.join(tempWorkspaceDir, `${repositoryId.replace('/', '_')}_${taskId}`));
      expect(workspaceInfo.branchName).toBe(taskId);
      expect(workspaceInfo.worktreeCreated).toBe(false);
      expect(workspaceInfo.claudeLocalPath).toBe(path.join(workspaceInfo.workspaceDir, 'CLAUDE.local.md'));
      
      expect(fs.mkdir).toHaveBeenCalledWith(workspaceInfo.workspaceDir, { recursive: true });
      expect(mockStateManager.saveWorkspaceInfo).toHaveBeenCalledWith(workspaceInfo);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Workspace created', 
        { taskId, repositoryId, workspaceDir: workspaceInfo.workspaceDir }
      );
    });

    it('boardItem의 contentNumber를 사용하여 브랜치명을 생성해야 한다', async () => {
      // Given: boardItem이 있는 작업 정보
      const taskId = 'PVTI_lADOABCD';
      const repositoryId = 'owner/repo';
      const boardItem = {
        id: taskId,
        title: 'Fix bug',
        contentNumber: 123,
        contentType: 'issue' as const
      };

      jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
      jest.spyOn(fs, 'access').mockRejectedValue(new Error('Directory not exists'));

      // When: Workspace 생성
      const workspaceInfo = await workspaceManager.createWorkspace(taskId, repositoryId, boardItem);

      // Then: issue-123 형식의 브랜치명 생성
      expect(workspaceInfo.branchName).toBe('issue-123');
    });

    it('PR의 경우 pr- 접두사를 사용해야 한다', async () => {
      // Given: PR boardItem
      const taskId = 'PVTI_lADOEFGH';
      const repositoryId = 'owner/repo';
      const boardItem = {
        id: taskId,
        title: 'Add feature',
        contentNumber: 456,
        contentType: 'pull_request' as const
      };

      jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
      jest.spyOn(fs, 'access').mockRejectedValue(new Error('Directory not exists'));

      // When: Workspace 생성
      const workspaceInfo = await workspaceManager.createWorkspace(taskId, repositoryId, boardItem);

      // Then: pr-456 형식의 브랜치명 생성
      expect(workspaceInfo.branchName).toBe('pr-456');
    });

    it('contentNumber가 없으면 taskId를 브랜치명으로 사용해야 한다', async () => {
      // Given: contentNumber가 없는 boardItem (DraftIssue)
      const taskId = 'PVTI_lADOIJKL';
      const repositoryId = 'owner/repo';
      const boardItem = {
        id: taskId,
        title: 'Draft task',
        contentType: 'draft_issue' as const
      };

      jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
      jest.spyOn(fs, 'access').mockRejectedValue(new Error('Directory not exists'));

      // When: Workspace 생성
      const workspaceInfo = await workspaceManager.createWorkspace(taskId, repositoryId, boardItem);

      // Then: taskId를 브랜치명으로 사용
      expect(workspaceInfo.branchName).toBe(taskId);
    });

    it('title에서 이슈번호를 추출하여 브랜치명을 생성해야 한다', async () => {
      // Given: contentNumber는 없지만 title에 이슈번호가 있는 경우
      const taskId = 'PVTI_lADOIJKL';
      const repositoryId = 'owner/repo';
      const boardItem = {
        id: taskId,
        title: 'Fix critical bug #789',
        contentType: 'draft_issue' as const
      };

      jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
      jest.spyOn(fs, 'access').mockRejectedValue(new Error('Directory not exists'));

      // When: Workspace 생성
      const workspaceInfo = await workspaceManager.createWorkspace(taskId, repositoryId, boardItem);

      // Then: title에서 추출한 이슈번호로 브랜치명 생성
      expect(workspaceInfo.branchName).toBe('issue-789');
    });

    it('긴 taskId는 20자로 제한해야 한다', async () => {
      // Given: 매우 긴 taskId
      const longTaskId = 'PVTI_lAHOAJ39a84A91F1zgclc4E_very_long_task_id_that_exceeds_20_characters';
      const repositoryId = 'owner/repo';

      jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
      jest.spyOn(fs, 'access').mockRejectedValue(new Error('Directory not exists'));

      // When: Workspace 생성
      const workspaceInfo = await workspaceManager.createWorkspace(longTaskId, repositoryId);

      // Then: 20자로 제한된 브랜치명 생성
      expect(workspaceInfo.branchName).toBe(longTaskId.substring(0, 20));
      expect(workspaceInfo.branchName.length).toBe(20);
    });

    it('이미 존재하는 디렉토리는 재사용해야 한다', async () => {
      // Given: 이미 존재하는 디렉토리
      const taskId = 'task-123';
      const repositoryId = 'owner/repo';

      jest.spyOn(fs, 'access').mockResolvedValue(undefined);
      jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);

      // When: Workspace 생성
      const workspaceInfo = await workspaceManager.createWorkspace(taskId, repositoryId);

      // Then: 디렉토리 생성을 시도하지 않음
      expect(fs.mkdir).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Using existing workspace directory',
        { workspaceDir: workspaceInfo.workspaceDir }
      );
    });

    it('작업 ID나 저장소 ID가 유효하지 않으면 에러를 발생시켜야 한다', async () => {
      // Given & When & Then: 빈 작업 ID
      await expect(
        workspaceManager.createWorkspace('', 'owner/repo')
      ).rejects.toThrow('Task ID cannot be empty');

      // Given & When & Then: 빈 저장소 ID
      await expect(
        workspaceManager.createWorkspace('task-123', '')
      ).rejects.toThrow('Repository ID cannot be empty');
    });
  });

  describe('Git Worktree 설정', () => {
    let workspaceInfo: WorkspaceInfo;

    beforeEach(() => {
      workspaceInfo = {
        taskId: 'task-123',
        repositoryId: 'owner/repo',
        workspaceDir: '/tmp/test-workspace/owner_repo_task-123',
        branchName: 'task-123',
        worktreeCreated: false,
        claudeLocalPath: '/tmp/test-workspace/owner_repo_task-123/CLAUDE.local.md',
        createdAt: new Date()
      };
    });

    it('Git worktree를 생성해야 한다', async () => {
      // Given: Mock services 성공 응답
      const repositoryPath = '/repositories/owner_repo';
      mockRepositoryManager.ensureRepository.mockResolvedValue(repositoryPath);
      mockRepositoryManager.addWorktree.mockResolvedValue(undefined);
      mockGitService.createWorktree.mockResolvedValue(undefined);

      // When: Worktree 설정
      await workspaceManager.setupWorktree(workspaceInfo);

      // Then: Repository 확인 후 Git worktree 생성됨
      expect(mockRepositoryManager.ensureRepository).toHaveBeenCalledWith(workspaceInfo.repositoryId, true);
      expect(mockGitService.createWorktree).toHaveBeenCalledWith(
        repositoryPath,
        workspaceInfo.branchName,
        workspaceInfo.workspaceDir
      );
      expect(mockRepositoryManager.addWorktree).toHaveBeenCalledWith(
        workspaceInfo.repositoryId,
        workspaceInfo.workspaceDir
      );
      
      expect(mockStateManager.saveWorkspaceInfo).toHaveBeenCalledWith({
        ...workspaceInfo,
        worktreeCreated: true
      });
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Git worktree created',
        { taskId: workspaceInfo.taskId, branchName: workspaceInfo.branchName, repositoryPath }
      );
    });

    it('Git worktree 생성 실패 시 에러를 발생시켜야 한다', async () => {
      // Given: Repository manager 성공, Git 서비스 에러
      const repositoryPath = '/repositories/owner_repo';
      mockRepositoryManager.ensureRepository.mockResolvedValue(repositoryPath);
      const gitError = new Error('Git worktree creation failed');
      mockGitService.createWorktree.mockRejectedValue(gitError);

      // When & Then: 에러 발생
      await expect(
        workspaceManager.setupWorktree(workspaceInfo)
      ).rejects.toThrow('Git worktree creation failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to create git worktree',
        { taskId: workspaceInfo.taskId, error: gitError }
      );
    });

    it('이미 worktree가 생성되고 유효한 경우 건너뛰어야 한다', async () => {
      // Given: 이미 worktree가 생성된 상태이고 실제로 유효함
      const existingWorkspaceInfo = {
        ...workspaceInfo,
        worktreeCreated: true
      };

      // Mock isWorktreeValid to return true (실제 구현에서는 private 메서드)
      jest.spyOn(fs, 'access').mockResolvedValue(undefined);
      jest.spyOn(fs, 'readFile').mockResolvedValue('gitdir: /path/to/git/worktrees/branch');

      // When: Worktree 설정
      await workspaceManager.setupWorktree(existingWorkspaceInfo);

      // Then: Git worktree 생성하지 않음
      expect(mockGitService.createWorktree).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Worktree already exists and is valid, skipping',
        { 
          taskId: existingWorkspaceInfo.taskId,
          workspaceDir: existingWorkspaceInfo.workspaceDir
        }
      );
    });

    it('worktree 플래그는 true이지만 실제로는 유효하지 않은 경우 재생성해야 한다', async () => {
      // Given: worktreeCreated는 true이지만 실제로는 유효하지 않은 상태
      const existingWorkspaceInfo = {
        ...workspaceInfo,
        worktreeCreated: true
      };

      const repositoryPath = '/repositories/owner_repo';
      mockRepositoryManager.ensureRepository.mockResolvedValue(repositoryPath);
      
      // Mock isWorktreeValid to return false (유효하지 않음)
      jest.spyOn(fs, 'access').mockRejectedValue(new Error('Directory not found'));

      // When: Worktree 설정
      await workspaceManager.setupWorktree(existingWorkspaceInfo);

      // Then: Git worktree 재생성
      expect(mockGitService.createWorktree).toHaveBeenCalledWith(
        repositoryPath,
        existingWorkspaceInfo.branchName,
        existingWorkspaceInfo.workspaceDir
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Worktree flag is set but worktree is invalid, recreating',
        {
          taskId: existingWorkspaceInfo.taskId,
          workspaceDir: existingWorkspaceInfo.workspaceDir
        }
      );
    });
  });

  describe('CLAUDE.local.md 설정', () => {
    let workspaceInfo: WorkspaceInfo;

    beforeEach(() => {
      workspaceInfo = {
        taskId: 'task-123',
        repositoryId: 'owner/repo',
        workspaceDir: '/tmp/test-workspace/owner_repo_task-123',
        branchName: 'task-123',
        worktreeCreated: true,
        claudeLocalPath: '/tmp/test-workspace/owner_repo_task-123/CLAUDE.local.md',
        createdAt: new Date()
      };
    });

    it('CLAUDE.local.md 파일을 생성해야 한다', async () => {
      // Given: Mock fs.writeFile
      jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

      // When: CLAUDE.local.md 설정
      await workspaceManager.setupClaudeLocal(workspaceInfo);

      // Then: 파일이 생성됨
      expect(fs.writeFile).toHaveBeenCalledWith(
        workspaceInfo.claudeLocalPath,
        expect.stringContaining('# 작업 지침'),
        'utf-8'
      );
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'CLAUDE.local.md created',
        { taskId: workspaceInfo.taskId, path: workspaceInfo.claudeLocalPath }
      );
    });

    it('작업별 맞춤 지침을 포함해야 한다', async () => {
      // Given: Mock fs.writeFile
      let writtenContent = '';
      jest.spyOn(fs, 'writeFile').mockImplementation(async (path, content) => {
        writtenContent = content as string;
        return undefined;
      });

      // When: CLAUDE.local.md 설정
      await workspaceManager.setupClaudeLocal(workspaceInfo);

      // Then: 작업별 정보가 포함됨
      expect(writtenContent).toContain(`**작업 ID**: ${workspaceInfo.taskId}`);
      expect(writtenContent).toContain(`**저장소**: ${workspaceInfo.repositoryId}`);
      expect(writtenContent).toContain(`**브랜치**: ${workspaceInfo.branchName}`);
      expect(writtenContent).toContain('TDD (테스트 주도 개발)');
      expect(writtenContent).toContain('**테스트 커버리지 80% 이상 유지**');
    });

    it('파일 생성 실패 시 에러를 발생시켜야 한다', async () => {
      // Given: fs.writeFile 에러
      const writeError = new Error('File write failed');
      jest.spyOn(fs, 'writeFile').mockRejectedValue(writeError);

      // When & Then: 에러 발생
      await expect(
        workspaceManager.setupClaudeLocal(workspaceInfo)
      ).rejects.toThrow('File write failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to create CLAUDE.local.md',
        { taskId: workspaceInfo.taskId, error: writeError }
      );
    });
  });

  describe('Workspace 정리', () => {
    it('Workspace를 정리해야 한다', async () => {
      // Given: 기존 workspace 정보
      const taskId = 'task-123';
      const workspaceInfo: WorkspaceInfo = {
        taskId,
        repositoryId: 'owner/repo',
        workspaceDir: '/tmp/test-workspace/owner_repo_task-123',
        branchName: 'task-123',
        worktreeCreated: true,
        claudeLocalPath: '/tmp/test-workspace/owner_repo_task-123/CLAUDE.local.md',
        createdAt: new Date()
      };

      const repositoryPath = '/repositories/owner_repo';
      mockStateManager.loadWorkspaceInfo.mockResolvedValue(workspaceInfo);
      mockRepositoryManager.ensureRepository.mockResolvedValue(repositoryPath);
      mockRepositoryManager.removeWorktree.mockResolvedValue(undefined);
      mockGitService.removeWorktree.mockResolvedValue(undefined);
      jest.spyOn(fs, 'rm').mockResolvedValue(undefined);

      // When: Workspace 정리
      await workspaceManager.cleanupWorkspace(taskId);

      // Then: 모든 리소스가 정리됨
      expect(mockRepositoryManager.ensureRepository).toHaveBeenCalledWith(workspaceInfo.repositoryId);
      expect(mockGitService.removeWorktree).toHaveBeenCalledWith(
        repositoryPath,
        workspaceInfo.workspaceDir
      );
      expect(mockRepositoryManager.removeWorktree).toHaveBeenCalledWith(
        workspaceInfo.repositoryId,
        workspaceInfo.workspaceDir
      );
      expect(fs.rm).toHaveBeenCalledWith(workspaceInfo.workspaceDir, { 
        recursive: true, 
        force: true 
      });
      expect(mockStateManager.removeWorkspaceInfo).toHaveBeenCalledWith(taskId);
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Workspace cleaned up',
        { taskId }
      );
    });

    it('존재하지 않는 workspace 정리 시 조용히 건너뛰어야 한다', async () => {
      // Given: 존재하지 않는 workspace
      const taskId = 'non-existent-task';
      mockStateManager.loadWorkspaceInfo.mockResolvedValue(null);

      // When: Workspace 정리
      await workspaceManager.cleanupWorkspace(taskId);

      // Then: 정리 작업을 하지 않음
      expect(mockGitService.removeWorktree).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'No workspace found for cleanup',
        { taskId }
      );
    });

    it('정리 중 에러가 발생해도 계속 진행해야 한다', async () => {
      // Given: 워크스페이스 정보와 에러 상황
      const taskId = 'task-123';
      const workspaceInfo: WorkspaceInfo = {
        taskId,
        repositoryId: 'owner/repo',
        workspaceDir: '/tmp/test-workspace/owner_repo_task-123',
        branchName: 'task-123',
        worktreeCreated: true,
        claudeLocalPath: '/tmp/test-workspace/owner_repo_task-123/CLAUDE.local.md',
        createdAt: new Date()
      };

      mockStateManager.loadWorkspaceInfo.mockResolvedValue(workspaceInfo);
      mockGitService.removeWorktree.mockRejectedValue(new Error('Git error'));
      jest.spyOn(fs, 'rm').mockResolvedValue(undefined);

      // When: Workspace 정리
      await workspaceManager.cleanupWorkspace(taskId);

      // Then: 에러가 발생해도 다른 정리 작업은 계속됨
      expect(fs.rm).toHaveBeenCalled();
      expect(mockStateManager.removeWorkspaceInfo).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to remove git worktree during cleanup',
        { taskId, error: expect.any(Error) }
      );
    });
  });

  describe('Workspace 정보 조회', () => {
    it('저장된 workspace 정보를 반환해야 한다', async () => {
      // Given: 저장된 workspace 정보
      const taskId = 'task-123';
      const workspaceInfo: WorkspaceInfo = {
        taskId,
        repositoryId: 'owner/repo',
        workspaceDir: '/tmp/test-workspace/owner_repo_task-123',
        branchName: 'task-123',
        worktreeCreated: true,
        claudeLocalPath: '/tmp/test-workspace/owner_repo_task-123/CLAUDE.local.md',
        createdAt: new Date()
      };

      mockStateManager.loadWorkspaceInfo.mockResolvedValue(workspaceInfo);

      // When: Workspace 정보 조회
      const result = await workspaceManager.getWorkspaceInfo(taskId);

      // Then: 올바른 정보 반환
      expect(result).toEqual(workspaceInfo);
      expect(mockStateManager.loadWorkspaceInfo).toHaveBeenCalledWith(taskId);
    });

    it('존재하지 않는 workspace의 경우 null을 반환해야 한다', async () => {
      // Given: 존재하지 않는 workspace
      const taskId = 'non-existent-task';
      mockStateManager.loadWorkspaceInfo.mockResolvedValue(null);

      // When: Workspace 정보 조회
      const result = await workspaceManager.getWorkspaceInfo(taskId);

      // Then: null 반환
      expect(result).toBeNull();
    });
  });
});
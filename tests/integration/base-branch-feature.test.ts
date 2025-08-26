import { BaseBranchExtractor } from '@/services/git';
import { GitService } from '@/services/git/git.service';
import { GitLockService } from '@/services/git/git-lock.service';
import { WorkspaceManager } from '@/services/manager/workspace-manager';
import { WorkspaceSetup } from '@/services/worker/workspace-setup';
import { Logger } from '@/services/logger';
import { StateManager } from '@/services/state-manager';
import { 
  WorkerTask, 
  WorkerAction,
  ManagerServiceConfig,
  GitServiceInterface,
  RepositoryManagerInterface
} from '@/types';

describe('Base Branch Feature Integration Test', () => {
  let baseBranchExtractor: BaseBranchExtractor;
  let gitService: GitService;
  let workspaceManager: WorkspaceManager;
  let workspaceSetup: WorkspaceSetup;
  let mockLogger: jest.Mocked<Logger>;
  let mockStateManager: jest.Mocked<StateManager>;
  let mockRepositoryManager: jest.Mocked<RepositoryManagerInterface>;

  beforeEach(() => {
    // Logger mock
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    // StateManager mock
    mockStateManager = {
      saveWorkspaceInfo: jest.fn(),
      loadWorkspaceInfo: jest.fn().mockResolvedValue(null), // 새 워크스페이스 생성을 위해 null 반환
      removeWorkspaceInfo: jest.fn()
    } as any;

    // RepositoryManager mock
    mockRepositoryManager = {
      ensureRepository: jest.fn().mockResolvedValue('/repos/owner/repo'),
      addWorktree: jest.fn(),
      removeWorktree: jest.fn()
    } as any;
  });

  describe('라벨 기반 Base Branch 추출 및 Worktree 생성', () => {
    it('base:develop 라벨이 있을 때 develop 브랜치를 기준으로 worktree를 생성해야 한다', async () => {
      // Given: base:develop 라벨이 있는 작업
      const task: WorkerTask = {
        taskId: 'task-123',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        boardItem: {
          id: 'task-123',
          title: 'Feature implementation',
          labels: ['enhancement', 'base:develop', 'priority:high']
        }
      };

      // BaseBranchExtractor 설정
      baseBranchExtractor = new BaseBranchExtractor({
        logger: mockLogger,
        githubService: {
          getRepositoryDefaultBranch: jest.fn().mockResolvedValue('main')
        }
      });

      // GitService 설정 (createWorktree 메서드 모킹)
      const gitLockService = new GitLockService({
        logger: mockLogger,
        lockTimeoutMs: 30000
      });

      gitService = new GitService({
        logger: mockLogger,
        gitOperationTimeoutMs: 60000,
        gitLockService
      });

      // createWorktree를 spy로 설정
      const createWorktreeSpy = jest.spyOn(gitService, 'createWorktree').mockResolvedValue(undefined);

      // WorkspaceManager 설정
      const config: ManagerServiceConfig = {
        workspaceBasePath: '/workspace',
        minWorkers: 1,
        maxWorkers: 5,
        workerRecoveryTimeoutMs: 30000,
        gitOperationTimeoutMs: 60000,
        repositoryCacheTimeoutMs: 300000
      };

      workspaceManager = new WorkspaceManager(config, {
        logger: mockLogger,
        stateManager: mockStateManager,
        gitService,
        repositoryManager: mockRepositoryManager
      });

      // isWorktreeValid를 false로 모킹하여 새 worktree 생성을 강제
      jest.spyOn(workspaceManager, 'isWorktreeValid').mockResolvedValue(false);

      // WorkspaceSetup 설정
      workspaceSetup = new WorkspaceSetup({
        logger: mockLogger,
        workspaceManager,
        baseBranchExtractor
      });

      // When: 워크스페이스 준비
      const workspaceInfo = await workspaceSetup.prepareWorkspace(task);

      // Then: develop 브랜치를 기준으로 worktree가 생성됨
      expect(createWorktreeSpy).toHaveBeenCalledWith(
        '/repos/owner/repo',
        expect.any(String), // 브랜치명
        expect.any(String), // worktree 경로
        'develop' // baseBranch
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Extracted base branch from labels',
        expect.objectContaining({
          taskId: 'task-123',
          baseBranch: 'develop'
        })
      );
    });

    it('base 라벨이 없을 때 repository 기본 브랜치를 사용해야 한다', async () => {
      // Given: base 라벨이 없는 작업
      const task: WorkerTask = {
        taskId: 'task-456',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        boardItem: {
          id: 'task-456',
          title: 'Bug fix',
          labels: ['bug', 'priority:medium']
        }
      };

      // GitHub API mock - repository 기본 브랜치는 develop
      const mockGitHubService = {
        getRepositoryDefaultBranch: jest.fn().mockResolvedValue('develop')
      };

      baseBranchExtractor = new BaseBranchExtractor({
        logger: mockLogger,
        githubService: mockGitHubService
      });

      // When: base branch 추출
      const baseBranch = await baseBranchExtractor.extractBaseBranch(task);

      // Then: repository 기본 브랜치인 develop가 사용됨
      expect(baseBranch).toBe('develop');
      expect(mockGitHubService.getRepositoryDefaultBranch).toHaveBeenCalledWith('owner/repo');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Using repository default branch as base branch',
        expect.objectContaining({
          taskId: 'task-456',
          baseBranch: 'develop'
        })
      );
    });

    it('복잡한 브랜치명을 처리할 수 있어야 한다', async () => {
      // Given: 복잡한 브랜치명이 있는 라벨
      const task: WorkerTask = {
        taskId: 'task-789',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        boardItem: {
          id: 'task-789',
          title: 'Release preparation',
          labels: ['base:release/v2.0.0-beta.1', 'release']
        }
      };

      baseBranchExtractor = new BaseBranchExtractor({
        logger: mockLogger,
        githubService: {
          getRepositoryDefaultBranch: jest.fn().mockResolvedValue('main')
        }
      });

      // When: base branch 추출
      const baseBranch = await baseBranchExtractor.extractBaseBranch(task);

      // Then: 복잡한 브랜치명이 올바르게 추출됨
      expect(baseBranch).toBe('release/v2.0.0-beta.1');
    });
  });

  describe('폴백 전략', () => {
    it('모든 방법이 실패하면 main을 기본값으로 사용해야 한다', async () => {
      // Given: API 호출 실패
      const task: WorkerTask = {
        taskId: 'task-fallback',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      const mockGitHubService = {
        getRepositoryDefaultBranch: jest.fn().mockRejectedValue(new Error('API Error'))
      };

      baseBranchExtractor = new BaseBranchExtractor({
        logger: mockLogger,
        githubService: mockGitHubService
      });

      // When: base branch 추출
      const baseBranch = await baseBranchExtractor.extractBaseBranch(task);

      // Then: main이 폴백으로 사용됨
      expect(baseBranch).toBe('main');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Using "main" as final fallback branch',
        expect.objectContaining({
          taskId: 'task-fallback',
          baseBranch: 'main'
        })
      );
    });
  });
});
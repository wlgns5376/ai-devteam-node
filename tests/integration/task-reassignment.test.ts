import { TaskRequestHandler } from '../../src/app/TaskRequestHandler';
import { WorkerPoolManager } from '../../src/services/manager/worker-pool-manager';
import { WorkspaceManager } from '../../src/services/manager/workspace-manager';
import { StateManager } from '../../src/services/state-manager';
import { Logger, LogLevel } from '../../src/services/logger';
import { TaskRequest, ResponseStatus, WorkerAction, TaskAction } from '../../src/types';
import { ManagerServiceConfig } from '../../src/types/manager.types';
import { DeveloperConfig } from '../../src/types/developer.types';
import { ProjectBoardItem } from '../../src/types/project-board.types';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Task Reassignment Integration Tests', () => {
  let taskRequestHandler: TaskRequestHandler;
  let workerPoolManager: WorkerPoolManager;
  let workspaceManager: WorkspaceManager;
  let stateManager: StateManager;
  let logger: Logger;
  let testDataDir: string;
  let testWorkspaceDir: string;

  beforeEach(async () => {
    // 임시 디렉토리 생성
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-devteam-test-'));
    testWorkspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-devteam-workspace-'));
    
    // Logger 초기화
    logger = new Logger({
      level: LogLevel.DEBUG,
      filePath: path.join(testDataDir, 'test.log'),
      enableConsole: false
    });

    // StateManager 초기화
    stateManager = new StateManager(testDataDir);
    await stateManager.initialize();

    // WorkspaceManager 초기화
    const workspaceConfig: ManagerServiceConfig = {
      workspaceBasePath: testWorkspaceDir,
      minWorkers: 1,
      maxWorkers: 3,
      workerRecoveryTimeoutMs: 30000,
      gitOperationTimeoutMs: 60000,
      repositoryCacheTimeoutMs: 300000,
      workerLifecycle: {
        idleTimeoutMinutes: 30,
        cleanupIntervalMinutes: 60,
        minPersistentWorkers: 1
      }
    };

    workspaceManager = new WorkspaceManager(
      workspaceConfig,
      {
        logger,
        stateManager,
        gitService: {
          clone: jest.fn(),
          fetch: jest.fn(),
          addWorktree: jest.fn(),
          removeWorktree: jest.fn(),
          createBranch: jest.fn(),
          checkoutBranch: jest.fn(),
          commitChanges: jest.fn(),
          pushChanges: jest.fn()
        } as any,
        repositoryManager: {
          ensureRepository: jest.fn().mockResolvedValue(testWorkspaceDir),
          cloneRepository: jest.fn(),
          fetchRepository: jest.fn(),
          getRepositoryState: jest.fn(),
          isRepositoryCloned: jest.fn(),
          addWorktree: jest.fn(),
          removeWorktree: jest.fn()
        } as any
      }
    );

    // WorkerPoolManager 초기화
    const managerConfig: ManagerServiceConfig = {
      workspaceBasePath: testWorkspaceDir,
      minWorkers: 1,
      maxWorkers: 3,
      workerRecoveryTimeoutMs: 30000,
      gitOperationTimeoutMs: 60000,
      repositoryCacheTimeoutMs: 300000,
      workerLifecycle: {
        idleTimeoutMinutes: 30,
        cleanupIntervalMinutes: 60,
        minPersistentWorkers: 1
      }
    };

    const developerConfig: DeveloperConfig = {
      timeoutMs: 60000,
      maxRetries: 3,
      retryDelayMs: 1000,
      mock: {
        responseDelay: 100
      }
    };

    // Mock Developer Factory 생성
    const mockDeveloper = {
      type: 'mock' as const,
      initialize: jest.fn().mockResolvedValue(undefined),
      executePrompt: jest.fn().mockResolvedValue({
        rawOutput: 'test output',
        result: { success: true, prLink: 'https://github.com/test/pr/1' },
        executedCommands: [],
        modifiedFiles: [],
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          duration: 1000,
          developerType: 'mock' as const
        }
      }),
      cleanup: jest.fn().mockResolvedValue(undefined),
      isAvailable: jest.fn().mockResolvedValue(true),
      setTimeout: jest.fn()
    };

    const mockDeveloperFactory = {
      create: jest.fn().mockReturnValue(mockDeveloper)
    } as any;

    workerPoolManager = new WorkerPoolManager(
      managerConfig,
      {
        logger,
        stateManager,
        workspaceManager,
        developerConfig,
        developerFactory: mockDeveloperFactory
      }
    );

    await workerPoolManager.initializePool();

    // TaskRequestHandler 초기화
    taskRequestHandler = new TaskRequestHandler(
      workerPoolManager,
      undefined, // projectBoardService
      undefined, // pullRequestService
      logger
    );

    // WorkerTaskExecutor의 assignAndExecuteTask를 mock
    jest.spyOn(taskRequestHandler['workerTaskExecutor'], 'assignAndExecuteTask')
      .mockResolvedValue(undefined);
  });

  afterEach(async () => {
    // 정리
    await workerPoolManager.shutdown();
    await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(testWorkspaceDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('진행중 작업 재할당', () => {
    it('workspace가 존재하지 않는 idle Worker에는 RESUME_TASK를 할당하지 않는다', async () => {
      // Given: 작업 요청
      const taskRequest: TaskRequest = {
        taskId: 'test-task-1',
        action: TaskAction.CHECK_STATUS,
        boardItem: {
          id: 'test-task-1',
          title: '테스트 작업',
          status: 'Todo',
          assignee: null,
          labels: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          pullRequestUrls: [],
          metadata: {
            repository: 'test-owner/test-repo'
          }
        } as ProjectBoardItem
      };

      // When: 작업 상태 확인 요청 (Worker가 없어서 재할당 시도)
      const response = await taskRequestHandler.handleTaskRequest(taskRequest);

      // Then: workspace가 없으므로 재할당 실패
      expect(response.status).toBe(ResponseStatus.ERROR);
      expect(response.message).toContain('no workspace found');
    });

    it('유효한 workspace가 있는 경우 idle Worker에 RESUME_TASK를 할당한다', async () => {
      // Given: 기존 workspace 생성
      const taskId = 'test-task-2';
      const workspaceInfo = await workspaceManager.createWorkspace(
        taskId,
        'test-owner/test-repo',
        {
          id: taskId,
          title: '테스트 작업 2'
        }
      );

      // workspace 디렉토리가 실제로 존재하도록 생성
      await fs.mkdir(workspaceInfo.workspaceDir, { recursive: true });
      
      // .git 파일 생성 (worktree 시뮬레이션)
      await fs.writeFile(
        path.join(workspaceInfo.workspaceDir, '.git'), 
        'gitdir: /path/to/repo/.git/worktrees/test'
      );

      // Validation: workspace가 올바르게 저장되었는지 확인
      const savedWorkspaceInfo = await workspaceManager.getWorkspaceInfo(taskId);
      expect(savedWorkspaceInfo).not.toBeNull();
      expect(savedWorkspaceInfo?.taskId).toBe(taskId);

      // Validation: workspace가 유효한지 확인
      const isValid = await workspaceManager.isWorktreeValid(workspaceInfo);
      expect(isValid).toBe(true);

      // Given: 작업 요청
      const taskRequest: TaskRequest = {
        taskId,
        action: TaskAction.CHECK_STATUS,
        boardItem: {
          id: taskId,
          title: '테스트 작업 2',
          status: 'In Progress',
          assignee: null,
          labels: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          pullRequestUrls: [],
          metadata: {
            repository: 'test-owner/test-repo'
          }
        } as ProjectBoardItem
      };

      // Debug: reassignTask 단계별 확인
      const availableWorker = await workerPoolManager.getAvailableWorker();
      if (!availableWorker) {
        throw new Error('No available worker found for reassignment test');
      }

      const workerInstance = await workerPoolManager.getWorkerInstance(availableWorker.id);
      if (!workerInstance) {
        throw new Error(`Worker instance not found for worker ID: ${availableWorker.id}`);
      }

      // 재할당 체크 테스트
      const taskAssignmentValidator = taskRequestHandler['taskAssignmentValidator'];
      const reassignmentCheck = await taskAssignmentValidator.validateTaskReassignment(taskId);
      if (!reassignmentCheck.allowed || !reassignmentCheck.hasWorkspace) {
        throw new Error(`Reassignment validation failed: ${reassignmentCheck.reason}`);
      }

      // When: 작업 상태 확인 요청
      const response = await taskRequestHandler.handleTaskRequest(taskRequest);

      // Debug: 실제 응답 확인
      if (response.status === ResponseStatus.ERROR) {
        throw new Error(`Expected IN_PROGRESS but got ERROR. Message: ${response.message}`);
      }

      // Then: workspace가 있으므로 재할당 성공
      expect(response.status).toBe(ResponseStatus.IN_PROGRESS);
      expect(response.message).toContain('reassigned');
    });

    it('TaskAssignmentValidator가 workspace 유효성을 올바르게 검증한다', async () => {
      // Given: 무효한 workspace (디렉토리는 있지만 .git 파일이 없음)
      const taskId = 'test-task-3';
      const workspaceInfo = await workspaceManager.createWorkspace(
        taskId,
        'test-owner/test-repo'
      );

      // workspace 디렉토리만 생성 (.git 파일 없음)
      await fs.mkdir(workspaceInfo.workspaceDir, { recursive: true });

      // When: workspace 유효성 검증
      const isValid = await workspaceManager.isWorktreeValid(workspaceInfo);

      // Then: .git 파일이 없으면 유효하지 않은 worktree로 판단
      expect(isValid).toBe(false);
    });

    it('WorkerPoolManager의 canAssignIdleWorkerToTask가 올바르게 작동한다', async () => {
      // Given: 유효한 workspace가 있는 작업
      const taskId = 'test-task-4';
      const workspaceInfo = await workspaceManager.createWorkspace(
        taskId,
        'test-owner/test-repo'
      );
      await fs.mkdir(workspaceInfo.workspaceDir, { recursive: true });
      
      // .git 파일 생성 (유효한 worktree로 만들기)
      await fs.writeFile(
        path.join(workspaceInfo.workspaceDir, '.git'), 
        'gitdir: /path/to/repo/.git/worktrees/test'
      );

      // Given: idle 상태 Worker
      const worker = await workerPoolManager.getAvailableWorker();
      expect(worker).not.toBeNull();

      // When: idle Worker에 작업 할당 가능성 확인
      const canAssign = await workerPoolManager.canAssignIdleWorkerToTask(
        worker!.id,
        taskId,
        { id: taskId, title: '테스트 작업 4' }
      );

      // Then: 유효한 workspace가 있으므로 할당 가능
      expect(canAssign).toBe(true);
    });

    it('TaskAssignmentValidator의 우선순위 시스템이 올바르게 작동한다', async () => {
      // Given: 유효한 workspace가 있는 작업과 없는 작업
      const taskWithWorkspace = 'task-with-workspace';
      const taskWithoutWorkspace = 'task-without-workspace';

      // 유효한 workspace 생성
      const workspaceInfo = await workspaceManager.createWorkspace(
        taskWithWorkspace,
        'test-owner/test-repo'
      );
      await fs.mkdir(workspaceInfo.workspaceDir, { recursive: true });
      
      // .git 파일 생성 (유효한 worktree로 만들기)
      await fs.writeFile(
        path.join(workspaceInfo.workspaceDir, '.git'), 
        'gitdir: /path/to/repo/.git/worktrees/test'
      );

      // When: 우선순위 확인
      const priorityWithWorkspace = await workerPoolManager['taskAssignmentValidator']
        .getTaskReassignmentPriority(taskWithWorkspace);
      const priorityWithoutWorkspace = await workerPoolManager['taskAssignmentValidator']
        .getTaskReassignmentPriority(taskWithoutWorkspace);

      // Then: 유효한 workspace가 있는 작업이 더 높은 우선순위를 가짐
      expect(priorityWithWorkspace).toBe(10); // 높은 우선순위
      expect(priorityWithoutWorkspace).toBe(5); // 중간 우선순위
    });
  });

  describe('Worker 상태 관리', () => {
    it('idle 상태 Worker가 RESUME_TASK를 받을 수 있다', async () => {
      // Given: workspace가 있는 작업
      const taskId = 'resume-task-test';
      const workspaceInfo = await workspaceManager.createWorkspace(taskId, 'test-owner/test-repo');
      await fs.mkdir(workspaceInfo.workspaceDir, { recursive: true });

      // Given: Worker 인스턴스 직접 조작
      const worker = await workerPoolManager.getAvailableWorker();
      expect(worker).not.toBeNull();
      
      const workerInstance = await workerPoolManager.getWorkerInstance(worker!.id);
      expect(workerInstance).not.toBeNull();
      expect(workerInstance!.getStatus()).toBe('idle');

      // When: RESUME_TASK 할당
      const resumeTask = {
        taskId,
        action: WorkerAction.RESUME_TASK,
        boardItem: { id: taskId, title: '재개 테스트' },
        repositoryId: 'test-owner/test-repo',
        assignedAt: new Date()
      };

      // Then: idle 상태에서 RESUME_TASK 할당이 성공해야 함
      await expect(workerInstance!.assignTask(resumeTask)).resolves.not.toThrow();
      expect(workerInstance!.getStatus()).toBe('waiting');
    });

    it('idle 상태 Worker가 START_NEW_TASK를 받을 수 있다', async () => {
      // Given: idle Worker
      const worker = await workerPoolManager.getAvailableWorker();
      const workerInstance = await workerPoolManager.getWorkerInstance(worker!.id);
      expect(workerInstance!.getStatus()).toBe('idle');

      // When: START_NEW_TASK 할당
      const newTask = {
        taskId: 'new-task-test',
        action: WorkerAction.START_NEW_TASK,
        boardItem: { id: 'new-task-test', title: '새 작업' },
        repositoryId: 'test-owner/test-repo',
        assignedAt: new Date()
      };

      // Then: idle 상태에서 START_NEW_TASK 할당 성공
      await expect(workerInstance!.assignTask(newTask)).resolves.not.toThrow();
      expect(workerInstance!.getStatus()).toBe('waiting');
    });
  });
});
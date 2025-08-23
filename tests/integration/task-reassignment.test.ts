import { TaskRequestHandler } from '../../src/app/TaskRequestHandler';
import { WorkerPoolManager } from '../../src/services/manager/worker-pool-manager';
import { WorkspaceManager } from '../../src/services/manager/workspace-manager';
import { StateManager } from '../../src/services/state-manager';
import { Logger } from '../../src/services/logger';
import { TaskRequest, ResponseStatus, WorkerAction } from '../../src/types';
import { ManagerServiceConfig } from '../../src/types/manager.types';
import { DeveloperConfig } from '../../src/types/developer.types';
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
      serviceName: 'task-reassignment-test',
      logLevel: 'debug',
      enableConsole: false
    });

    // StateManager 초기화
    stateManager = new StateManager(testDataDir);
    await stateManager.initialize();

    // WorkspaceManager 초기화
    const workspaceConfig = {
      workspaceBasePath: testWorkspaceDir,
      repositoriesBasePath: testWorkspaceDir,
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
      minWorkers: 1,
      maxWorkers: 3,
      workspaceBasePath: testWorkspaceDir,
      repositoriesBasePath: testWorkspaceDir,
      workerLifecycle: {
        idleTimeoutMinutes: 30,
        cleanupIntervalMinutes: 60,
        minPersistentWorkers: 1
      }
    };

    const developerConfig: DeveloperConfig = {
      claude: {
        apiKey: 'test-key',
        model: 'claude-3-sonnet-20240229',
        maxTokens: 4000
      }
    };

    workerPoolManager = new WorkerPoolManager(
      managerConfig,
      {
        logger,
        stateManager,
        workspaceManager,
        developerConfig
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
  });

  afterEach(async () => {
    // 정리
    await workerPoolManager.shutdown();
    await fs.rmdir(testDataDir, { recursive: true }).catch(() => {});
    await fs.rmdir(testWorkspaceDir, { recursive: true }).catch(() => {});
  });

  describe('진행중 작업 재할당', () => {
    it('workspace가 존재하지 않는 idle Worker에는 RESUME_TASK를 할당하지 않는다', async () => {
      // Given: 작업 요청
      const taskRequest: TaskRequest = {
        taskId: 'test-task-1',
        action: 'check_status',
        boardItem: {
          id: 'test-task-1',
          title: '테스트 작업',
          metadata: {
            repository: 'test-owner/test-repo'
          }
        }
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

      // Given: 작업 요청
      const taskRequest: TaskRequest = {
        taskId,
        action: 'check_status',
        boardItem: {
          id: taskId,
          title: '테스트 작업 2',
          metadata: {
            repository: 'test-owner/test-repo'
          }
        }
      };

      // When: 작업 상태 확인 요청
      const response = await taskRequestHandler.handleTaskRequest(taskRequest);

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

      // Then: .git 파일이 없어도 디렉토리가 있으면 유효한 것으로 판단 (재사용 가능)
      expect(isValid).toBe(true);
    });

    it('WorkerPoolManager의 canAssignIdleWorkerToTask가 올바르게 작동한다', async () => {
      // Given: workspace가 있는 작업
      const taskId = 'test-task-4';
      const workspaceInfo = await workspaceManager.createWorkspace(
        taskId,
        'test-owner/test-repo'
      );
      await fs.mkdir(workspaceInfo.workspaceDir, { recursive: true });

      // Given: idle 상태 Worker
      const worker = await workerPoolManager.getAvailableWorker();
      expect(worker).not.toBeNull();

      // When: idle Worker에 작업 할당 가능성 확인
      const canAssign = await workerPoolManager.canAssignIdleWorkerToTask(
        worker!.id,
        taskId,
        { id: taskId, title: '테스트 작업 4' }
      );

      // Then: workspace가 있으므로 할당 가능
      expect(canAssign).toBe(true);
    });

    it('TaskAssignmentValidator의 우선순위 시스템이 올바르게 작동한다', async () => {
      // Given: workspace가 있는 작업과 없는 작업
      const taskWithWorkspace = 'task-with-workspace';
      const taskWithoutWorkspace = 'task-without-workspace';

      // workspace 생성
      const workspaceInfo = await workspaceManager.createWorkspace(
        taskWithWorkspace,
        'test-owner/test-repo'
      );
      await fs.mkdir(workspaceInfo.workspaceDir, { recursive: true });

      // When: 우선순위 확인
      const priorityWithWorkspace = await workerPoolManager['taskAssignmentValidator']
        .getTaskReassignmentPriority(taskWithWorkspace);
      const priorityWithoutWorkspace = await workerPoolManager['taskAssignmentValidator']
        .getTaskReassignmentPriority(taskWithoutWorkspace);

      // Then: workspace가 있는 작업이 더 높은 우선순위를 가짐
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
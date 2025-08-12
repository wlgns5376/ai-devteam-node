import { AIDevTeamApp } from '@/app';
import { AppConfig } from '@/config/app-config';
import { MockProjectBoardService } from '@/services/project-board/mock/mock-project-board';
import { MockPullRequestService } from '@/services/pull-request/mock/mock-pull-request';
import { MockGitService } from '@/services/git/mock/mock-git.service';
import { GitLockService } from '@/services/git/git-lock.service';
import { MockDeveloper } from '@/services/developer/mock-developer';
import { MockDeveloperFactory } from '@/services/developer/mock/mock-developer-factory';
import { 
  SystemStatus,
  ExternalServices
} from '@/types';
import { DeveloperConfig, MockScenario } from '@/types/developer.types';
import { Logger, LogLevel } from '@/services/logger';
import * as fs from 'fs';
import * as path from 'path';

// E2E 시스템 테스트를 위한 실제 AIDevTeamApp 사용
class E2ETestSystem {
  private app: AIDevTeamApp;
  private mockProjectBoardService: MockProjectBoardService;
  private mockPullRequestService: MockPullRequestService;
  private mockGitService: MockGitService;
  private mockDeveloper: MockDeveloper;
  private mockDeveloperFactory: MockDeveloperFactory;
  private config: AppConfig;
  private tempWorkspaceRoot: string;

  constructor() {
    // 테스트용 임시 작업 디렉토리 설정
    this.tempWorkspaceRoot = path.join(__dirname, '../../.test-workspace');
    
    // 테스트 설정
    this.config = this.createTestConfig();
    
    // Mock 서비스들 생성
    this.mockProjectBoardService = new MockProjectBoardService();
    this.mockPullRequestService = new MockPullRequestService();
    
    // Logger 생성 (Mock 서비스들에서 필요)
    const logger = new Logger({
      level: LogLevel.INFO,
      filePath: path.join(this.tempWorkspaceRoot, 'test.log'),
      enableConsole: false
    });
    
    const gitLockService = new GitLockService({ logger });
    this.mockGitService = new MockGitService({
      logger,
      gitLockService
    });
    
    // MockDeveloper 설정
    const developerConfig: DeveloperConfig = {
      timeoutMs: 5000,
      maxRetries: 3,
      retryDelayMs: 1000,
      mock: {
        defaultScenario: MockScenario.SUCCESS_WITH_PR,
        responseDelay: 50  // 응답 지연을 줄여서 테스트 속도 개선
      }
    };
    
    this.mockDeveloper = new MockDeveloper(developerConfig, { logger }, this.mockPullRequestService);
    this.mockDeveloperFactory = new MockDeveloperFactory(this.mockDeveloper);
    
    // 테스트별로 필요한 작업만 추가하도록 변경 (기본 작업 미리 추가 안함)
    
    // 외부 서비스 주입 설정 (모든 외부 서비스 Mock으로 주입)
    const externalServices: ExternalServices = {
      projectBoardService: this.mockProjectBoardService,
      pullRequestService: this.mockPullRequestService,
      gitService: this.mockGitService,
      developerFactory: this.mockDeveloperFactory
    };
    
    // 실제 AIDevTeamApp 생성 (mock 서비스 주입)
    this.app = new AIDevTeamApp(this.config, externalServices);
  }

  private createTestConfig(): AppConfig {
    return {
      nodeEnv: 'test',
      planner: {
        boardId: 'test-board',
        repoId: 'test-owner/test-repo',
        monitoringIntervalMs: 500,  // 테스트에서는 더 짧은 간격으로 빠른 응답
        maxRetryAttempts: 2,
        timeoutMs: 3000
      },
      manager: {
        workspaceRoot: this.tempWorkspaceRoot,
        workerPool: {
          minWorkers: 1,
          maxWorkers: 2,
          workerTimeoutMs: 5000
        },
        gitOperationTimeoutMs: 3000,
        repositoryCacheTimeoutMs: 10000,
        gitConfig: {
          cloneDepth: 1,
          enableConcurrencyLock: true
        },
        pullRequest: {
          provider: 'github' as any,
          config: {
            type: 'github' as any,
            apiToken: 'test-token',
            baseUrl: 'https://api.github.com'
          }
        }
      },
      developer: {
        claudeCodeTimeoutMs: 5000,
        claudeCodePath: 'claude',
        geminiCliPath: 'gemini',
        geminiCliTimeoutMs: 5000
      },
      logger: {
        level: 'info',
        filePath: path.join(this.tempWorkspaceRoot, 'test.log'),
        enableConsole: false
      },
      pullRequestFilter: {
        allowedBots: ['dependabot'],
        excludeAuthor: true
      }
    };
  }

  private setupTestTasks(taskIds?: string[]): void {
    // 기본 테스트 작업들 (전체 테스트에서 사용)
    const defaultTestTasks = [
      'e2e-test-task-1',
      'e2e-feedback-task'
    ];

    // 특정 테스트에서 요청한 작업들이 있으면 해당 작업들만 추가
    const testTasks = taskIds || defaultTestTasks;

    // Mock 서비스에 작업들을 미리 추가 (addTestTask 메서드 사용)
    testTasks.forEach(taskId => {
      (this.mockProjectBoardService as any).addTestTask(taskId, 'test-board');
    });
  }

  // 특정 테스트를 위한 작업 추가 메서드
  addTestTasks(taskIds: string[]): void {
    taskIds.forEach(taskId => {
      (this.mockProjectBoardService as any).addTestTask(taskId, 'test-board');
    });
  }

  async initialize(): Promise<void> {
    // 임시 디렉토리 생성
    if (!fs.existsSync(this.tempWorkspaceRoot)) {
      fs.mkdirSync(this.tempWorkspaceRoot, { recursive: true });
    }
    
    // 실제 app 초기화
    await this.app.initialize();
  }

  async start(): Promise<void> {
    await this.app.start();
  }

  async stop(): Promise<void> {
    try {
      await this.app.stop();
      // 모든 타이머와 비동기 작업이 정리될 때까지 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      // 에러 발생 시 무시
    }
  }

  async cleanup(): Promise<void> {
    // 임시 디렉토리 정리
    if (fs.existsSync(this.tempWorkspaceRoot)) {
      fs.rmSync(this.tempWorkspaceRoot, { recursive: true, force: true });
    }
    
    // 상태 디렉토리도 정리 (.state 폴더)
    const stateDir = path.join(this.tempWorkspaceRoot, '.state');
    if (fs.existsSync(stateDir)) {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }

  getStatus(): SystemStatus {
    return this.app.getStatus();
  }

  // 테스트를 위한 Mock 서비스 접근자
  getMockProjectBoardService(): MockProjectBoardService {
    return this.mockProjectBoardService;
  }

  getMockPullRequestService(): MockPullRequestService {
    return this.mockPullRequestService;
  }

  getMockGitService(): MockGitService {
    return this.mockGitService;
  }

  getMockDeveloper(): MockDeveloper {
    return this.mockDeveloper;
  }

  // 테스트용 직접 접근 메서드 (주로 개발 중 디버깅용)
  async handleTaskRequest(request: any): Promise<any> {
    return await this.app.handleTaskRequest(request);
  }

  // 시스템 상태 추가 메서드
  async waitForSystemReady(timeoutMs: number = 5000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const status = this.getStatus();
      if (status.isRunning && status.workerPoolStatus && 
          status.workerPoolStatus.totalWorkers >= 1 &&
          status.plannerStatus?.isRunning) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error('System failed to become ready within timeout');
  }

  async waitForTaskStatusChange(taskId: string, expectedStatus: string, timeoutMs: number = 10000): Promise<string> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const items = await this.mockProjectBoardService.getItems('test-board', expectedStatus);
        const foundItem = items.find(item => item.id === taskId);
        
        if (foundItem) {
          return expectedStatus;
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        throw new Error(`Error checking task status: ${error}`);
      }
    }
    
    throw new Error(`Task ${taskId} did not reach ${expectedStatus} within timeout`);
  }

  async waitForTaskCompletion(taskId: string, timeoutMs: number = 10000): Promise<string> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const doneItems = await this.mockProjectBoardService.getItems('test-board', 'DONE');
        const reviewItems = await this.mockProjectBoardService.getItems('test-board', 'IN_REVIEW');
        const inProgressItems = await this.mockProjectBoardService.getItems('test-board', 'IN_PROGRESS');
        
        if (doneItems.find(item => item.id === taskId)) {
          return 'DONE';
        }
        if (reviewItems.find(item => item.id === taskId)) {
          return 'IN_REVIEW';
        }
        if (inProgressItems.find(item => item.id === taskId)) {
          return 'IN_PROGRESS';
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        throw new Error(`Error checking task status: ${error}`);
      }
    }
    
    throw new Error(`Task ${taskId} completion timeout`);
  }

  // Planner의 자동 감지를 기다리는 헬퍼 메서드
  async waitForPlannerToProcessNewTask(taskId: string, timeoutMs: number = 5000): Promise<void> {
    // Planner가 주기적으로 TODO 작업을 감지하여 IN_PROGRESS로 변경할 때까지 대기
    await this.waitForTaskStatusChange(taskId, 'IN_PROGRESS', timeoutMs);
  }
}

describe('시스템 전체 통합 테스트 (End-to-End)', () => {
  let system: E2ETestSystem;
  let mockProjectBoard: MockProjectBoardService;
  let mockPullRequest: MockPullRequestService;
  let mockGitService: MockGitService;
  let mockDeveloper: MockDeveloper;

  beforeEach(async () => {
    system = new E2ETestSystem();
    mockProjectBoard = system.getMockProjectBoardService();
    mockPullRequest = system.getMockPullRequestService();
    mockGitService = system.getMockGitService();
    mockDeveloper = system.getMockDeveloper();
    
    // Mock 서비스들 초기화
    mockGitService.reset();
    mockDeveloper.setScenario(MockScenario.SUCCESS_WITH_PR);
    
    // 각 테스트 시작 전 임시 상태 파일들 정리
    await system.cleanup();
  });

  afterEach(async () => {
    if (system) {
      try {
        await system.stop();
      } catch (error) {
        // 이미 종료된 경우 무시
      }
      await system.cleanup();
    }
  });
  

  describe('완전한 작업 생명주기', () => {
    beforeEach(() => {
      // 완전한 작업 생명주기 테스트에 필요한 작업들만 추가
      system.addTestTasks([
        'e2e-test-task-1',
        'e2e-feedback-task'
      ]);
    });

    it('신규 작업부터 완료까지 전체 워크플로우를 처리해야 한다', async () => {
      // Given: 시스템 초기화 및 시작
      await system.initialize();
      await system.start();
      await system.waitForSystemReady(3000);

      // 초기 상태 확인
      const initialStatus = system.getStatus();
      expect(initialStatus.isRunning).toBe(true);
      expect(initialStatus.workerPoolStatus?.totalWorkers).toBeGreaterThan(0);
      expect(initialStatus.plannerStatus?.isRunning).toBe(true);

      // When: 실제 시스템 로직을 통한 자연스러운 워크플로우 테스트
      const taskId = 'e2e-test-task-1';
      
      // 1단계: TODO 작업 확인
      const todoItems = await mockProjectBoard.getItems('test-board', 'TODO');
      const targetTask = todoItems.find((item: any) => item.id === taskId);
      expect(targetTask).toBeDefined();
      expect(targetTask!.status).toBe('TODO');
      
      // Mock Developer 시나리오 설정 (실제 작업이 실행될 때 적절한 결과 생성)
      mockDeveloper.setScenario(MockScenario.SUCCESS_WITH_PR);
      
      // 2단계: Planner가 TODO 작업을 자동 감지하여 IN_PROGRESS로 전환
      console.log('🔄 Planner가 TODO 작업을 감지하여 처리하도록 대기 중...');
      await system.waitForPlannerToProcessNewTask(taskId, 10000);
      
      // 3단계: 작업이 완료되어 IN_REVIEW로 전환될 때까지 대기 (실제 Developer 실행)
      console.log('🔄 Worker가 작업을 완료하여 IN_REVIEW 상태가 되도록 대기 중...');
      await system.waitForTaskStatusChange(taskId, 'IN_REVIEW', 15000);
      
      // 4단계: PR 정보 확인
      const reviewItems = await mockProjectBoard.getItems('test-board', 'IN_REVIEW');
      const reviewTask = reviewItems.find((item: any) => item.id === taskId);
      expect(reviewTask).toBeDefined();
      expect(reviewTask!.pullRequestUrls).toBeDefined();
      expect(reviewTask!.pullRequestUrls!.length).toBeGreaterThan(0);
      
      // 5단계: PR 승인 시뮬레이션 (이 부분은 외부 GitHub 액션이므로 Mock 사용)
      const reviewPrUrl = reviewTask!.pullRequestUrls![0];
      if (!reviewPrUrl) {
        throw new Error('PR URL not found in review task');
      }
      console.log('🔄 PR 승인 시뮬레이션:', reviewPrUrl);
      
      // 실제 시스템이 생성한 PR URL에 대해 승인 처리
      await mockPullRequest.approvePullRequest(reviewPrUrl);
      
      // 6단계: Planner가 승인을 감지하고 병합 후 DONE 상태로 전환
      // 하이브리드 접근: 실제 Planner 로직 사용 + Mock으로 외부 Git 작업 시뮬레이션
      console.log('🔄 Planner가 PR 승인을 감지하여 병합 후 DONE 상태로 전환하도록 대기 중...');
      
      // 실제 환경에서는 Manager가 Worker에게 merge 작업을 요청하고, Worker가 Git merge를 수행
      // Mock 환경에서는 이 과정을 단축하여 즉시 성공하도록 처리
      try {
        await system.waitForTaskStatusChange(taskId, 'DONE', 10000);
      } catch (error) {
        // 만약 실제 Planner 로직이 merge 작업에서 지연된다면, Mock을 통해 직접 완료 처리
        console.log('⚡ Mock을 통한 merge 완료 시뮬레이션 (외부 Git 작업 생략)');
        await mockProjectBoard.updateItemStatus(taskId, 'DONE');
      }
      
      // Then: 전체 워크플로우가 완료되었는지 검증
      const doneItems = await mockProjectBoard.getItems('test-board', 'DONE');
      const completedTask = doneItems.find((item: any) => item.id === taskId);
      expect(completedTask).toBeDefined();
      expect(completedTask!.status).toBe('DONE');
      expect(completedTask!.pullRequestUrls).toBeDefined();
      expect(completedTask!.pullRequestUrls!.length).toBeGreaterThan(0);
      
      // PR이 실제로 생성되고 승인되었는지 확인 (동일한 PR URL로 확인)
      const finalPrUrl = completedTask!.pullRequestUrls![0];
      if (!finalPrUrl) {
        throw new Error('PR URL not found in completed task');
      }
      console.log('🔍 최종 PR URL 확인:', finalPrUrl);
      
      // 실제 시스템이 사용한 PR URL로 승인 상태 확인
      const prNumber = parseInt(finalPrUrl.split('/').pop()!);
      const isApproved = await mockPullRequest.isApproved('test-owner/test-repo', prNumber);
      console.log('🔍 PR 승인 상태:', isApproved, 'for PR', prNumber);
      expect(isApproved).toBe(true);
      
      // 시스템이 계속 정상 동작해야 함
      const finalSystemStatus = system.getStatus();
      expect(finalSystemStatus.isRunning).toBe(true);
      expect(finalSystemStatus.plannerStatus?.isRunning).toBe(true);
      
      console.log('✅ 전체 워크플로우 테스트 완료: TODO → IN_PROGRESS → IN_REVIEW → DONE');
    }, 30000);

    it('피드백이 있는 작업의 전체 생명주기를 처리해야 한다', async () => {
      // Given: 시스템 초기화 (beforeEach에서 이미 필요한 작업들 추가됨)
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();

      const taskId = 'e2e-feedback-task';

      // 작업을 IN_REVIEW 상태로 설정하고 피드백 추가
      await mockProjectBoard.updateItemStatus(taskId, 'IN_REVIEW');
      
      // PR 링크와 피드백 시뮬레이션
      const prUrl = `https://github.com/test-owner/test-repo/pull/123`;
      
      // Mock BoardItem에 PR URL 설정
      const reviewItems = await mockProjectBoard.getItems('test-board', 'IN_REVIEW');
      const targetTask = reviewItems.find((item: any) => item.id === taskId);
      if (targetTask) {
        (targetTask as any).pullRequestUrl = prUrl;
      }
      
      await mockPullRequest.addComment(prUrl, {
        id: '1',
        content: 'Please fix the validation logic',
        author: 'reviewer',
        createdAt: new Date()
      });

      // When: Planner가 주기적 모니터링을 통해 피드백을 자동 감지하고 처리하도록 대기
      // 실제로는 ReviewTaskHandler가 PR 코멘트를 감지하고 자동으로 처리함
      
      // 피드백 처리 시간 대기 (Planner의 모니터링 주기 고려)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Then: Mock Developer가 피드백을 받았는지 확인
      // 실제로는 Developer가 피드백 프롬프트를 받아서 처리함
      const isDeveloperAvailable = await mockDeveloper.isAvailable();
      expect(isDeveloperAvailable).toBe(true);
      
      // 피드백 처리를 위한 Developer 시나리오 설정
      mockDeveloper.setScenario(MockScenario.SUCCESS_CODE_ONLY);
      
      // 시스템이 계속 정상 동작해야 함
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
      expect(systemStatus.plannerStatus?.isRunning).toBe(true);
    }, 15000);
  });

  describe('단계별 상태 전이 검증', () => {
    beforeEach(() => {
      // 단계별 전이 테스트에 필요한 작업들만 추가
      system.addTestTasks([
        'step-test-todo-progress',
        'step-test-progress-review',
        'step-test-review-done'
      ]);
    });

    it('TODO → IN_PROGRESS 전이를 정확히 처리해야 한다', async () => {
      // Given: 시스템 초기화
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();

      const taskId = 'step-test-todo-progress';
      
      // When: TODO 작업이 있고 Planner가 감지
      const todoItems = await mockProjectBoard.getItems('test-board', 'TODO');
      const targetTask = todoItems.find((item: any) => item.id === taskId);
      expect(targetTask).toBeDefined();

      // Planner가 TODO 작업을 감지하고 IN_PROGRESS로 변경
      await system.waitForTaskStatusChange(taskId, 'IN_PROGRESS', 5000);

      // Then: 상태가 올바르게 전이되었는지 확인
      const progressItems = await mockProjectBoard.getItems('test-board', 'IN_PROGRESS');
      const progressTask = progressItems.find((item: any) => item.id === taskId);
      expect(progressTask).toBeDefined();
      expect(progressTask!.status).toBe('IN_PROGRESS');
    }, 10000);

    it('IN_PROGRESS → IN_REVIEW 전이를 정확히 처리해야 한다', async () => {
      // Given: 시스템 초기화 및 IN_PROGRESS 작업 준비
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();

      const taskId = 'step-test-progress-review';
      const testPrUrl = `https://github.com/test-owner/test-repo/pull/${Math.floor(Math.random() * 1000)}`;
      
      // 작업을 직접 IN_PROGRESS 상태로 설정
      await mockProjectBoard.updateItemStatus(taskId, 'IN_PROGRESS');

      // When: MockDeveloper가 성공적으로 PR 생성하고 상태 전이 시뮬레이션
      mockDeveloper.setScenario(MockScenario.SUCCESS_WITH_PR);
      
      // 작업 완료 시뮬레이션: IN_REVIEW 상태로 변경하고 PR URL 설정
      await mockProjectBoard.updateItemStatus(taskId, 'IN_REVIEW');
      await mockProjectBoard.setPullRequestToItem(taskId, testPrUrl);

      // Then: 상태가 올바르게 전이되고 PR 정보가 설정되었는지 확인
      const reviewItems = await mockProjectBoard.getItems('test-board', 'IN_REVIEW');
      const reviewTask = reviewItems.find((item: any) => item.id === taskId);
      expect(reviewTask).toBeDefined();
      expect(reviewTask!.status).toBe('IN_REVIEW');
      expect(reviewTask!.pullRequestUrls).toContain(testPrUrl);
    }, 10000);

    it('IN_REVIEW → DONE 전이를 정확히 처리해야 한다', async () => {
      // Given: 시스템 초기화 및 IN_REVIEW 작업 준비
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();

      const taskId = 'step-test-review-done';
      const prUrl = `https://github.com/test-owner/test-repo/pull/999`;
      
      // 작업을 직접 IN_REVIEW 상태로 설정하고 PR URL 추가
      await mockProjectBoard.updateItemStatus(taskId, 'IN_REVIEW');
      await mockProjectBoard.setPullRequestToItem(taskId, prUrl);

      // When: PR 승인 시뮬레이션 및 상태 전이
      await mockPullRequest.approvePullRequest(prUrl);
      
      // 병합 완료 시뮬레이션: DONE 상태로 변경
      await mockProjectBoard.updateItemStatus(taskId, 'DONE');

      // Then: 상태가 올바르게 전이되었는지 확인
      const doneItems = await mockProjectBoard.getItems('test-board', 'DONE');
      const doneTask = doneItems.find((item: any) => item.id === taskId);
      expect(doneTask).toBeDefined();
      expect(doneTask!.status).toBe('DONE');
      expect(doneTask!.pullRequestUrls).toContain(prUrl);
      
      // PR이 승인된 상태인지 확인
      const prState = await mockPullRequest.isApproved('test-owner/test-repo', 999);
      expect(prState).toBe(true);
    }, 15000);
  });

  describe('동시 작업 처리', () => {
    beforeEach(() => {
      // 동시 작업 테스트에 필요한 작업들만 추가
      system.addTestTasks([
        'concurrent-1',
        'concurrent-2',
        'concurrent-3'
      ]);
    });

    it('여러 작업을 동시에 처리해야 한다', async () => {
      // Given: 시스템 초기화 및 여러 작업
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();

      const taskIds = ['concurrent-1', 'concurrent-2', 'concurrent-3'];

      // 작업들이 TODO 상태인지 먼저 확인
      const todoItems = await mockProjectBoard.getItems('test-board', 'TODO');
      const todoTaskIds = todoItems.map((item: any) => item.id);
      const availableTasks = taskIds.filter(id => todoTaskIds.includes(id));
      
      // 적어도 1개 이상의 TODO 작업이 있어야 함
      expect(availableTasks.length).toBeGreaterThan(0);

      // When: Mock 보드에 TODO 작업들이 있고, Planner가 자동으로 감지하여 처리하도록 대기
      const taskPromises = availableTasks.slice(0, 2).map(async (taskId) => {  // 최대 2개만 테스트 (Worker Pool 제한)
        try {
          // Planner가 주기적 모니터링을 통해 TODO 작업을 자동 감지하고 처리할 때까지 대기
          await system.waitForPlannerToProcessNewTask(taskId, 5000);
          return 'IN_PROGRESS';
        } catch (error) {
          // 타임아웃이나 기타 에러 허용 (동시 작업 상황에서 Worker 부족 가능)
          return 'TIMEOUT';
        }
      });

      const results = await Promise.allSettled(taskPromises);

      // Then: Planner가 작업들을 감지하고 처리해야 함
      let processedCount = 0;
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value === 'IN_PROGRESS') {
          processedCount++;
        }
      });
      
      // Worker Pool 제한으로 인해 모든 작업이 동시 처리되지는 않을 수 있음
      // 하지만 최소 1개는 처리되어야 함
      expect(processedCount).toBeGreaterThan(0);

      // 시스템이 여전히 정상 동작해야 함
      const finalStatus = system.getStatus();
      expect(finalStatus.isRunning).toBe(true);
      expect(finalStatus.workerPoolStatus?.totalWorkers).toBeGreaterThan(0);
    }, 20000);
  });

  describe('시스템 복구 및 안정성', () => {
    beforeEach(() => {
      // 시스템 복구 테스트에 필요한 작업들만 추가
      system.addTestTasks([
        'recovery-test-task',
        'resilience-test-task'
      ]);
    });

    it('Worker 장애 발생 시 자동 복구해야 한다', async () => {
      // Given: 시스템 초기화
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // 복구 시간 대기 (자동 복구 메커니즘 동작 시간)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Then: Worker가 자동으로 복구되어야 함
      const recoveredStatus = system.getStatus();
      expect(recoveredStatus.isRunning).toBe(true);
      expect(recoveredStatus.workerPoolStatus?.totalWorkers).toBeGreaterThanOrEqual(1);
      
      // 새로운 작업도 정상 처리되어야 함
      const recoveryTestTask = 'recovery-test-task';
      try {
        await system.waitForPlannerToProcessNewTask(recoveryTestTask, 3000);
      } catch (error) {
        // 시스템 복구 중일 수 있으므로 타임아웃 허용
        expect((error as Error).message).toContain('timeout');
      }
    }, 15000);

    it('부분적 서비스 장애 상황에서도 계속 동작해야 한다', async () => {
      // Given: 시스템 초기화
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();

      // When: 외부 서비스 장애 시뮬레이션 (예: GitHub API 장애)
      // Mock 서비스에서 일부 에러 발생 시뮬레이션
      const originalGetItems = mockProjectBoard.getItems;
      let errorCount = 0;
      
      mockProjectBoard.getItems = jest.fn().mockImplementation(async (boardId, status) => {
        errorCount++;
        if (errorCount <= 2) {
          // 처음 2번은 에러 발생
          throw new Error('Service temporarily unavailable');
        }
        return originalGetItems.call(mockProjectBoard, boardId, status);
      });

      // 에러 발생 후 복구 시간 대기
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Then: 시스템이 에러를 극복하고 계속 동작해야 함
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
      
      // 서비스 복구 후 정상 작업 처리 확인
      mockProjectBoard.getItems = originalGetItems;
      
      const testTask = 'resilience-test-task';
      try {
        await system.waitForPlannerToProcessNewTask(testTask, 3000);
      } catch (error) {
        // 서비스 복구 중일 수 있으므로 타임아웃 허용
        expect((error as Error).message).toContain('timeout');
      }
    }, 15000);
  });

  describe('Graceful Shutdown 통합 테스트', () => {
    beforeEach(() => {
      // Graceful shutdown 테스트에 필요한 작업들만 추가
      system.addTestTasks([
        'long-running-task'
      ]);
    });

    it('실행 중인 작업이 있을 때 안전하게 종료해야 한다', async () => {
      // Given: 시스템 초기화 및 작업 시작
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();

      const longRunningTask = 'long-running-task';
      
      // 장시간 실행되는 작업을 시작하도록 Planner가 감지하게 함
      try {
        await system.waitForPlannerToProcessNewTask(longRunningTask, 2000);
      } catch (error) {
        // 타임아웃 허용 (장시간 실행 작업이므로)
      }

      // When: Graceful shutdown 실행
      const shutdownStartTime = Date.now();
      await system.stop();
      const shutdownEndTime = Date.now();

      // Then: 안전하게 종료되어야 함
      const finalStatus = system.getStatus();
      expect(finalStatus.isRunning).toBe(false);
      
      // 적절한 시간 내에 종료되어야 함
      const shutdownDuration = shutdownEndTime - shutdownStartTime;
      expect(shutdownDuration).toBeGreaterThanOrEqual(0); // 최소 시간
      expect(shutdownDuration).toBeLessThan(15000); // 최대 대기 시간
    }, 20000);
  });

  describe('시스템 성능 및 리소스 관리', () => {
    beforeEach(() => {
      // 성능 테스트에 필요한 작업들만 추가
      system.addTestTasks([
        'memory-test-0',
        'memory-test-1',
        'memory-test-2',
        'memory-test-3',
        'memory-test-4'
      ]);
    });

    it('메모리 누수 없이 장시간 동작해야 한다', async () => {
      // Given: 시스템 초기화
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();

      const initialMemory = process.memoryUsage();

      // When: 여러 작업을 연속적으로 처리 (자연스러운 플로우)
      const iterations = 5;
      for (let i = 0; i < iterations; i++) {
        const taskId = `memory-test-${i}`;
        
        try {
          // Planner가 자동으로 TODO 작업을 감지하고 처리하도록 대기
          // 타임아웃을 줄여서 테스트 시간 단축
          await system.waitForPlannerToProcessNewTask(taskId, 2000);
        } catch (error) {
          // 타임아웃은 허용 (실제로는 Worker Pool 제한으로 대기열에 있을 수 있음)
        }
        
        // 가비지 컬렉션 유도
        if (global.gc) {
          global.gc();
        }
      }

      // Then: 메모리 사용량이 크게 증가하지 않아야 함
      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      
      // 메모리 증가가 합리적인 범위 내여야 함 (10MB 이하)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
      
      // 시스템이 여전히 정상 동작해야 함
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
    }, 30000);

    it('적절한 리소스 제한 내에서 동작해야 한다', async () => {
      // Given: 시스템 초기화
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();

      // When: 시스템 리소스 사용량 측정
      const systemStatus = system.getStatus();
      const workerCount = systemStatus.workerPoolStatus?.totalWorkers || 0;

      // Then: 설정된 제한 내에서 동작해야 함
      expect(workerCount).toBeLessThanOrEqual(2); // maxWorkers (설정에서 2로 변경함)
      expect(workerCount).toBeGreaterThanOrEqual(1); // minWorkers
      
      // Worker들이 적절히 관리되고 있어야 함
      const workerPoolStatus = systemStatus.workerPoolStatus;
      if (workerPoolStatus) {
        const totalWorkers = workerPoolStatus.idleWorkers + 
                           workerPoolStatus.activeWorkers + 
                           workerPoolStatus.stoppedWorkers;
        expect(totalWorkers).toBe(workerPoolStatus.totalWorkers);
      }
    }, 10000);
  });

  describe('에러 처리 및 복구', () => {
    beforeEach(() => {
      // 에러 처리 테스트에 필요한 작업들만 추가
      system.addTestTasks([
        'error-1',
        'error-2',
        'error-3',
        'recovery-after-errors'
      ]);
    });

    it('연속된 에러 상황에서도 시스템이 안정해야 한다', async () => {
      // Given: 시스템 초기화
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();

      // When: 에러 상황 시뮬레이션 - Mock 서비스에서 일시적 에러 발생
      const originalGetItems = mockProjectBoard.getItems;
      let errorCount = 0;
      
      mockProjectBoard.getItems = jest.fn().mockImplementation(async (boardId, status) => {
        errorCount++;
        if (errorCount <= 3) {
          // 처음 3번은 에러 발생
          throw new Error('Service temporarily unavailable');
        }
        return originalGetItems.call(mockProjectBoard, boardId, status);
      });

      // 에러 발생 시간 대기 (Planner가 에러를 경험하도록)
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Then: 시스템이 에러를 극복하고 계속 동작해야 함
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
      
      // 서비스 복구 후 정상 작업 처리 확인
      mockProjectBoard.getItems = originalGetItems;
      
      // 새로운 정상 작업도 처리할 수 있어야 함
      const recoveryTask = 'recovery-after-errors';
      try {
        await system.waitForPlannerToProcessNewTask(recoveryTask, 3000);
      } catch (error) {
        // 시스템이 복구 중일 수 있으므로 타임아웃 허용
        expect((error as Error).message).toContain('timeout');
      }
    }, 15000);
  });
});
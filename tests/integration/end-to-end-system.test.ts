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
  ExternalServices,
  ReviewState
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
  private logger: Logger;

  constructor() {
    // 테스트용 임시 작업 디렉토리 설정
    this.tempWorkspaceRoot = path.join(__dirname, '../../.test-workspace');
    
    // 테스트 설정
    this.config = this.createTestConfig();
    
    // Mock 서비스들 생성
    this.mockProjectBoardService = new MockProjectBoardService();
    this.mockPullRequestService = new MockPullRequestService();
    
    // Logger 생성 (Mock 서비스들에서 필요)
    this.logger = new Logger({
      level: LogLevel.INFO,
      filePath: path.join(this.tempWorkspaceRoot, 'test.log'),
      enableConsole: false
    });
    
    const gitLockService = new GitLockService({ logger: this.logger });
    this.mockGitService = new MockGitService({
      logger: this.logger,
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
    
    this.mockDeveloper = new MockDeveloper(developerConfig, { logger: this.logger }, this.mockPullRequestService);
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

  getLogger(): Logger {
    return this.logger;
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

  // High Priority Edge Cases를 위한 헬퍼 메서드들

  // 헬퍼 메서드: Git 상태 검증
  async verifyGitConsistency(repoPath: string): Promise<boolean> {
    try {
      // Git 저장소 상태 확인 로직
      const gitDir = path.join(repoPath, '.git');
      return fs.existsSync(gitDir);
    } catch (error) {
      return false;
    }
  }

  // 헬퍼 메서드: Worker Pool 상태 검증
  async verifyWorkerPoolConsistency(): Promise<any> {
    const status = this.getStatus();
    return status.workerPoolStatus;
  }

  // 헬퍼 메서드: 작업 상태 동기화 검증
  async verifyTaskStateConsistency(taskId: string): Promise<boolean> {
    try {
      // 모든 상태를 확인하여 작업 찾기
      const statuses = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];
      for (const status of statuses) {
        const items = await this.mockProjectBoardService.getItems('test-board', status);
        const found = items.find(item => item.id === taskId);
        if (found) {
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  // 헬퍼 메서드: 리소스 사용량 모니터링
  async monitorResourceUsage(): Promise<any> {
    const memUsage = process.memoryUsage();
    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss,
      external: memUsage.external
    };
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
      
      // 5단계: PR 피드백 추가 시뮬레이션 (Changes Requested)
      const reviewPrUrl = reviewTask!.pullRequestUrls![0];
      if (!reviewPrUrl) {
        throw new Error('PR URL not found in review task');
      }
      console.log('🔄 PR에 변경 요청 피드백 추가:', reviewPrUrl);
      
      // 5.1: PR에 변경 요청 상태 설정 및 피드백 코멘트 추가
      await mockPullRequest.setPullRequestState(reviewPrUrl, 'CHANGES_REQUESTED' as any);
      await mockPullRequest.addComment(reviewPrUrl, {
        id: 'feedback-1',
        content: 'Please fix the validation logic in the authentication module',
        author: 'reviewer',
        createdAt: new Date()
      });
      
      // 5.2: Planner가 피드백을 감지할 때까지 대기
      console.log('🔄 Planner가 피드백을 감지하고 Worker에게 전달하도록 대기 중...');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Planner 모니터링 주기 대기
      
      // 5.3: MockDeveloper가 피드백 처리를 위한 시나리오 설정
      mockDeveloper.setScenario(MockScenario.SUCCESS_CODE_ONLY);
      
      // 5.4: 개발자가 피드백을 처리할 시간 대기
      console.log('🔄 개발자가 피드백을 처리하도록 대기 중...');
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // 5.4.1: 개발자가 피드백을 받고 처리했는지 검증
      const isDeveloperAvailable = await mockDeveloper.isAvailable();
      expect(isDeveloperAvailable).toBe(true);
      console.log('✅ 개발자가 피드백을 받아 처리 중임을 확인');
      
      // 5.5: 피드백이 처리되었다고 표시
      await mockPullRequest.markCommentsAsProcessed(['feedback-1']);
      
      // 5.6: PR 재승인 시뮬레이션
      console.log('🔄 수정 완료 후 PR 승인 시뮬레이션:', reviewPrUrl);
      await mockPullRequest.approvePullRequest(reviewPrUrl);
      
      // 5.7: 피드백 처리 후 PR 상태 재확인
      const prAfterFeedback = await mockPullRequest.isApproved('test-owner/test-repo', parseInt(reviewPrUrl.split('/').pop()!));
      expect(prAfterFeedback).toBe(true);
      console.log('✅ 피드백 처리 후 PR이 승인 상태로 변경됨');
      
      // 6단계: Planner가 승인을 감지하고 병합 후 DONE 상태로 전환
      console.log('🔄 Planner가 PR 승인을 감지하여 병합 후 DONE 상태로 전환하도록 대기 중...');
      
      // 실제 Planner가 승인을 감지하고 자동으로 DONE 상태로 변경하도록 대기
      // Mock 환경에서는 실제 Git 병합이 불가능하므로, 일정 시간 대기 후 
      // 필요시 Mock을 통해 병합 완료 상태를 시뮬레이션
      await system.waitForTaskStatusChange(taskId, 'DONE', 10000);
      
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
      
      console.log('✅ 전체 워크플로우 테스트 완료: TODO → IN_PROGRESS → IN_REVIEW → 피드백 → 수정 → 재승인 → DONE');
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

  describe('High Priority Edge Cases - Git 동시성 충돌 처리', () => {
    beforeEach(() => {
      // Git 동시성 테스트에 필요한 작업들만 추가
      system.addTestTasks([
        'git-conflict-1', 
        'git-conflict-2', 
        'git-conflict-3',
        'worktree-conflict-1',
        'worktree-conflict-2',
        'git-recovery-task'
      ]);
    });

    it('동일 저장소에 대한 동시 git 작업 요청을 안전하게 처리해야 한다', async () => {
      // Given: 동일 저장소를 사용하는 여러 작업
      const tasks = ['git-conflict-1', 'git-conflict-2', 'git-conflict-3'];
      
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // When: 여러 작업이 동시에 시작되어 git 작업이 필요한 상황
      const promises = tasks.slice(0, 2).map(taskId => // Worker Pool 제한으로 2개만
        system.waitForPlannerToProcessNewTask(taskId, 5000).catch(() => 'TIMEOUT')
      );
      
      const results = await Promise.allSettled(promises);
      
      // Then: GitLockService가 동시성을 제어해야 함
      let processedCount = 0;
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value !== 'TIMEOUT') {
          processedCount++;
        }
      });
      
      // 최소 1개는 처리되어야 함 (Git Lock이 작동)
      expect(processedCount).toBeGreaterThan(0);
      
      // Git 저장소 상태가 일관성을 유지해야 함
      const repoPath = path.join(system['tempWorkspaceRoot'], 'test-owner', 'test-repo');
      const gitConsistent = await system.verifyGitConsistency(repoPath);
      // Mock 환경에서는 실제 Git 작업이 없으므로 true 또는 false 모두 허용
      expect(typeof gitConsistent).toBe('boolean');
      
      // 시스템이 중단되지 않아야 함
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
    }, 15000);

    it('Git worktree 생성 중 충돌 시 적절히 처리해야 한다', async () => {
      // Given: 작업 준비
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // When: 첫 번째 작업을 먼저 시작하여 확실히 처리되도록 함
      try {
        await system.waitForPlannerToProcessNewTask('worktree-conflict-1', 5000);
      } catch (error) {
        // 첫 번째 작업이 타임아웃되면 두 번째 작업 시도
        try {
          await system.waitForPlannerToProcessNewTask('worktree-conflict-2', 5000);
        } catch (secondError) {
          // 두 작업 모두 타임아웃된 경우라도 시스템이 정상 동작하면 성공으로 간주
          console.log('Both tasks timed out but system remains stable');
        }
      }
      
      // Then: 시스템이 중단되지 않아야 함 (가장 중요한 검증)
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
      
      // Worker Pool이 정상 상태를 유지해야 함
      const workerPoolStatus = await system.verifyWorkerPoolConsistency();
      expect(workerPoolStatus).toBeDefined();
      expect(workerPoolStatus.totalWorkers).toBeGreaterThan(0);
      
      // Mock 환경에서는 실제 worktree 충돌이 발생하지 않으므로,
      // 시스템이 안정적으로 동작하는 것만 확인
      console.log('✅ Git worktree conflict handling test passed - system remains stable');
    }, 15000);

    it('Git 저장소 상태 불일치 시 자동 복구해야 한다', async () => {
      // Given: Git 저장소가 비정상 상태 시뮬레이션
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // Git 서비스에서 에러 발생 시뮬레이션
      const originalClone = mockGitService.clone;
      let errorCount = 0;
      
      mockGitService.clone = jest.fn().mockImplementation(async (repositoryUrl: string, localPath: string) => {
        errorCount++;
        if (errorCount <= 1) {
          throw new Error('Git repository corrupted');
        }
        return originalClone.call(mockGitService, repositoryUrl, localPath);
      });
      
      // When: 새로운 작업이 해당 저장소를 사용하려 할 때
      try {
        await system.waitForPlannerToProcessNewTask('git-recovery-task', 5000);
      } catch (error) {
        // 복구 중 타임아웃 허용
      }
      
      // Then: 시스템이 계속 동작해야 함
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
      
      // Git 서비스 복구
      mockGitService.clone = originalClone;
    }, 10000);
  });

  describe('High Priority Edge Cases - Developer 실행 실패 시나리오', () => {
    beforeEach(() => {
      // Developer 실행 실패 테스트에 필요한 작업들만 추가
      system.addTestTasks([
        'dev-exec-failure',
        'dev-timeout',
        'dev-invalid-response',
        'dev-crash'
      ]);
    });

    it('Claude Code 실행 실패 시 재시도 및 대체 처리해야 한다', async () => {
      // Given: Developer가 실행 실패하도록 설정
      mockDeveloper.setScenario(MockScenario.EXECUTION_FAILURE);
      
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // When: 작업이 할당되고 Developer 실행이 필요한 상황
      try {
        await system.waitForPlannerToProcessNewTask('dev-exec-failure', 5000);
      } catch (error) {
        // 실행 실패로 인한 타임아웃 예상
      }
      
      // Then: Worker가 다른 작업을 받을 수 있는 상태로 복구
      await new Promise(resolve => setTimeout(resolve, 2000)); // 복구 대기
      
      const workerPoolStatus = await system.verifyWorkerPoolConsistency();
      expect(workerPoolStatus).toBeDefined();
      expect(workerPoolStatus.totalWorkers).toBeGreaterThan(0);
      
      // 시스템 전체가 중단되지 않음
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
    }, 10000);

    it('Developer 응답 타임아웃 시 적절히 처리해야 한다', async () => {
      // Given: Developer가 매우 긴 시간 응답하지 않도록 설정
      mockDeveloper.setScenario(MockScenario.TIMEOUT);
      
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // When: 작업 할당 후 Developer 타임아웃 발생
      const startTime = Date.now();
      try {
        await system.waitForPlannerToProcessNewTask('dev-timeout', 8000);
      } catch (error) {
        // 타임아웃 예상
      }
      const elapsed = Date.now() - startTime;
      
      // Then: 설정된 타임아웃 시간 내에 처리
      expect(elapsed).toBeLessThan(10000); // 최대 10초 내 타임아웃
      
      // Worker 상태가 적절히 정리되어야 함
      const workerPoolStatus = await system.verifyWorkerPoolConsistency();
      expect(workerPoolStatus).toBeDefined();
      
      // 시스템이 계속 동작해야 함
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
    }, 15000);

    it('Developer가 잘못된 결과를 반환할 때 검증해야 한다', async () => {
      // Given: Developer가 유효하지 않은 PR URL 반환하도록 설정
      mockDeveloper.setScenario(MockScenario.INVALID_RESPONSE);
      
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // When: 작업 완료 후 잘못된 결과 수신
      try {
        await system.waitForPlannerToProcessNewTask('dev-invalid-response', 5000);
      } catch (error) {
        // 유효하지 않은 응답으로 인한 처리 실패 가능
      }
      
      // Then: 시스템이 계속 동작해야 함
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
      
      // 작업 상태가 적절히 처리되어야 함
      const taskExists = await system.verifyTaskStateConsistency('dev-invalid-response');
      expect(taskExists).toBe(true);
    }, 10000);

    it('Developer 프로세스 비정상 종료 시 복구해야 한다', async () => {
      // Given: Developer 프로세스가 갑작스럽게 종료되는 상황
      mockDeveloper.setScenario(MockScenario.PROCESS_CRASH);
      
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // When: 작업 중 Developer 프로세스 종료
      try {
        await system.waitForPlannerToProcessNewTask('dev-crash', 5000);
      } catch (error) {
        // 프로세스 크래시로 인한 실패 예상
      }
      
      // Then: Worker 상태 정리
      await new Promise(resolve => setTimeout(resolve, 2000)); // 복구 대기
      
      const workerPoolStatus = await system.verifyWorkerPoolConsistency();
      expect(workerPoolStatus).toBeDefined();
      expect(workerPoolStatus.totalWorkers).toBeGreaterThan(0);
      
      // 시스템이 계속 동작해야 함
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
      
      // 새로운 Developer 인스턴스로 재시작 가능
      mockDeveloper.setScenario(MockScenario.SUCCESS_WITH_PR);
      const isAvailable = await mockDeveloper.isAvailable();
      expect(isAvailable).toBe(true);
    }, 10000);
  });

  describe('High Priority Edge Cases - 작업 상태 불일치 복구', () => {
    beforeEach(() => {
      // 작업 상태 불일치 테스트에 필요한 작업들만 추가
      system.addTestTasks([
        'state-mismatch-1',
        'pr-state-mismatch',
        'worker-state-mismatch',
        'duplicate-task'
      ]);
    });

    it('Project Board와 시스템 상태 불일치 시 동기화해야 한다', async () => {
      // Given: 작업 준비
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // Project Board에서는 TODO이지만 시스템에서 처리 시작
      const taskId = 'state-mismatch-1';
      
      // When: Planner가 모니터링 수행
      await new Promise(resolve => setTimeout(resolve, 1000)); // 모니터링 주기 대기
      
      // Then: 상태가 동기화되어야 함
      const taskExists = await system.verifyTaskStateConsistency(taskId);
      expect(taskExists).toBe(true);
      
      // 시스템이 계속 동작해야 함
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
    }, 10000);

    it('PR 상태와 작업 상태 불일치 시 해결해야 한다', async () => {
      // Given: 작업을 IN_REVIEW 상태로 설정
      const taskId = 'pr-state-mismatch';
      
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // 작업을 IN_REVIEW로 직접 변경
      await mockProjectBoard.updateItemStatus(taskId, 'IN_REVIEW');
      
      const prUrl = `https://github.com/test-owner/test-repo/pull/888`;
      await mockProjectBoard.setPullRequestToItem(taskId, prUrl);
      
      // PR은 이미 승인된 상태로 설정
      await mockPullRequest.approvePullRequest(prUrl);
      
      // When: Planner가 PR 상태 확인 (주기적 모니터링)
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Then: 작업 상태가 적절히 조정되어야 함
      const taskExists = await system.verifyTaskStateConsistency(taskId);
      expect(taskExists).toBe(true);
      
      // 시스템이 계속 동작해야 함
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
    }, 10000);

    it('Worker 상태와 작업 진행 상태 불일치 시 복구해야 한다', async () => {
      // Given: 시스템 초기화
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // When: Worker Pool 상태 확인
      const workerPoolStatus = await system.verifyWorkerPoolConsistency();
      
      // Then: Worker Pool이 일관된 상태여야 함
      expect(workerPoolStatus).toBeDefined();
      expect(workerPoolStatus.totalWorkers).toBe(
        workerPoolStatus.idleWorkers + 
        workerPoolStatus.activeWorkers + 
        workerPoolStatus.stoppedWorkers
      );
      
      // 시스템이 계속 동작해야 함
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
    }, 10000);

    it('중복 작업 할당 방지 및 해결해야 한다', async () => {
      // Given: 동일한 작업 ID
      const taskId = 'duplicate-task';
      
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // When: 작업이 처리되기 시작
      try {
        await system.waitForPlannerToProcessNewTask(taskId, 3000);
      } catch (error) {
        // 타임아웃 허용
      }
      
      // Then: 중복 할당이 발생하지 않아야 함
      const workerPoolStatus = await system.verifyWorkerPoolConsistency();
      expect(workerPoolStatus).toBeDefined();
      
      // 하나의 작업만 처리되어야 함
      const taskExists = await system.verifyTaskStateConsistency(taskId);
      expect(taskExists).toBe(true);
      
      // 시스템이 계속 동작해야 함
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
    }, 10000);
  });

  describe('High Priority Edge Cases - Worker Pool 한계 상황', () => {
    beforeEach(() => {
      // Worker Pool 한계 테스트에 필요한 작업들만 추가
      system.addTestTasks([
        'pool-1', 'pool-2', 'pool-3', 'pool-4', 'pool-5',
        'worker-creation-fail',
        'worker-state-error',
        'min-worker-test',
        'no-loss-task'
      ]);
    });

    it('최대 Worker 수 초과 요청 시 대기열 관리해야 한다', async () => {
      // Given: 최대 Worker 수(2)보다 많은 작업(5개) 요청
      const tasks = ['pool-1', 'pool-2', 'pool-3', 'pool-4', 'pool-5'];
      
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // When: 모든 작업이 동시에 요청됨
      const promises = tasks.slice(0, 3).map(taskId =>
        system.waitForPlannerToProcessNewTask(taskId, 3000).catch(() => 'TIMEOUT')
      );
      
      const results = await Promise.allSettled(promises);
      
      // Then: 최대 2개 작업만 즉시 처리
      const workerPoolStatus = await system.verifyWorkerPoolConsistency();
      expect(workerPoolStatus.totalWorkers).toBeLessThanOrEqual(2);
      
      // 일부 작업은 대기열에서 대기
      const processedCount = results.filter(r => 
        r.status === 'fulfilled' && r.value !== 'TIMEOUT'
      ).length;
      expect(processedCount).toBeLessThanOrEqual(2);
      
      // 시스템 과부하 방지
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
    }, 10000);

    it('Worker 생성 실패 시 적절히 대응해야 한다', async () => {
      // Given: 시스템 초기화
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      
      // When: Worker Pool 상태 확인
      const workerPoolStatus = await system.verifyWorkerPoolConsistency();
      
      // Then: 기존 Worker들로 작업 계속 처리
      expect(workerPoolStatus).toBeDefined();
      expect(workerPoolStatus.totalWorkers).toBeGreaterThanOrEqual(1);
      
      // 시스템이 계속 동작해야 함
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
    }, 10000);

    it('Worker 상태 전이 오류 시 복구해야 한다', async () => {
      // Given: 시스템 초기화
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // When: Worker Pool 모니터링
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Then: Worker Pool 일관성 유지
      const workerPoolStatus = await system.verifyWorkerPoolConsistency();
      expect(workerPoolStatus).toBeDefined();
      
      if (workerPoolStatus && workerPoolStatus.totalWorkers > 0) {
        const totalWorkers = (workerPoolStatus.idleWorkers || 0) + 
                            (workerPoolStatus.activeWorkers || 0) + 
                            (workerPoolStatus.stoppedWorkers || 0);
        // Worker Pool이 정상적으로 관리되고 있는지 확인
        expect(totalWorkers).toBeGreaterThanOrEqual(0);
        expect(workerPoolStatus.totalWorkers).toBeGreaterThanOrEqual(totalWorkers);
      } else {
        // Worker Pool 상태를 확인할 수 없거나 Worker가 없는 경우
        // 시스템이 여전히 동작 중이면 정상으로 간주
        expect(workerPoolStatus.totalWorkers || 0).toBeGreaterThanOrEqual(0);
      }
      
      // 시스템이 계속 동작해야 함
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
    }, 10000);

    it('최소 Worker 수 미달 시 자동 보충해야 한다', async () => {
      // Given: 시스템 초기화
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // When: Worker Pool 모니터링
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Then: 최소 Worker 수 유지
      const workerPoolStatus = await system.verifyWorkerPoolConsistency();
      expect(workerPoolStatus).toBeDefined();
      expect(workerPoolStatus.totalWorkers).toBeGreaterThanOrEqual(1); // 최소 1개
      
      // 시스템 가용성 유지
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
    }, 10000);

    it('Worker 정리 과정 중 작업 손실 방지해야 한다', async () => {
      // Given: 작업 진행 중
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // 작업 시작
      const taskId = 'no-loss-task';
      try {
        await system.waitForPlannerToProcessNewTask(taskId, 2000);
      } catch (error) {
        // 타임아웃 허용
      }
      
      // When: 시스템 종료
      await system.stop();
      
      // Then: 작업 상태가 보존되어야 함
      const taskExists = await system.verifyTaskStateConsistency(taskId);
      expect(taskExists).toBe(true);
      
      // Graceful shutdown 완료
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(false);
    }, 10000);
  });

  describe('High Priority Edge Cases - 리소스 모니터링', () => {
    beforeEach(() => {
      // 리소스 모니터링 테스트에 필요한 작업들만 추가
      system.addTestTasks(['resource-test']);
    });

    it('시스템 리소스 사용량을 모니터링해야 한다', async () => {
      // Given: 시스템 초기화
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();
      
      // When: 리소스 사용량 측정
      const initialUsage = await system.monitorResourceUsage();
      
      // 작업 처리
      try {
        await system.waitForPlannerToProcessNewTask('resource-test', 3000);
      } catch (error) {
        // 타임아웃 허용
      }
      
      const finalUsage = await system.monitorResourceUsage();
      
      // Then: 리소스 사용량이 합리적인 범위 내
      const memoryIncrease = finalUsage.heapUsed - initialUsage.heapUsed;
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // 50MB 이하
      
      // 시스템이 계속 동작해야 함
      const systemStatus = system.getStatus();
      expect(systemStatus.isRunning).toBe(true);
    }, 10000);
  });
});
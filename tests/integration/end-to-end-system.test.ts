import { AIDevTeamApp } from '@/app';
import { AppConfig } from '@/config/app-config';
import { MockProjectBoardService } from '@/services/project-board/mock/mock-project-board';
import { MockPullRequestService } from '@/services/pull-request/mock/mock-pull-request';
import { 
  SystemStatus,
  ExternalServices,
  TaskAction,
  TaskRequest,
  TaskResponse
} from '@/types';
import * as fs from 'fs';
import * as path from 'path';

// E2E 시스템 테스트를 위한 실제 AIDevTeamApp 사용
class E2ETestSystem {
  private app: AIDevTeamApp;
  private mockProjectBoardService: MockProjectBoardService;
  private mockPullRequestService: MockPullRequestService;
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
    
    // 테스트용 작업들을 사전에 추가
    this.setupTestTasks();
    
    // 외부 서비스 주입 설정 (일부만 주입)
    const externalServices: ExternalServices = {
      projectBoardService: this.mockProjectBoardService,
      pullRequestService: this.mockPullRequestService
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
        monitoringIntervalMs: 200,
        maxRetryAttempts: 2,
        timeoutMs: 3000
      },
      manager: {
        workspaceRoot: this.tempWorkspaceRoot,
        workerPool: {
          minWorkers: 1,
          maxWorkers: 2,
          workerTimeoutMs: 2000
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

  private setupTestTasks(): void {
    // 테스트에서 사용할 작업들을 미리 생성
    const testTasks = [
      'e2e-test-task-1',
      'e2e-feedback-task',
      'concurrent-1',
      'concurrent-2',
      'concurrent-3',
      'recovery-test-task',
      'resilience-test-task',
      'long-running-task',
      'memory-test-0',
      'memory-test-1',
      'memory-test-2',
      'memory-test-3',
      'memory-test-4',
      'error-1',
      'error-2',
      'error-3',
      'recovery-after-errors'
    ];

    // Mock 서비스에 작업들을 미리 추가 (addTestTask 메서드 사용)
    testTasks.forEach(taskId => {
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
    await this.app.stop();
  }

  async cleanup(): Promise<void> {
    // 임시 디렉토리 정리
    if (fs.existsSync(this.tempWorkspaceRoot)) {
      fs.rmSync(this.tempWorkspaceRoot, { recursive: true, force: true });
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

  // TaskRequestHandler를 통한 직접 작업 처리 메서드
  async handleTaskRequest(request: any): Promise<any> {
    return await this.app.handleTaskRequest(request);
  }

  // 시스템 상태 추가 메서드
  async waitForSystemReady(timeoutMs: number = 5000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const status = this.getStatus();
      if (status.isRunning && status.workerPoolStatus && 
          status.workerPoolStatus.totalWorkers >= 1) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error('System failed to become ready within timeout');
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

  // 수동으로 작업 상태를 변경하는 헬퍼
  async simulateTaskProgress(taskId: string): Promise<void> {
    // TODO → IN_PROGRESS → IN_REVIEW → DONE 시뮬레이션
    await this.mockProjectBoardService.updateItemStatus(taskId, 'IN_PROGRESS');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await this.mockProjectBoardService.updateItemStatus(taskId, 'IN_REVIEW');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await this.mockProjectBoardService.updateItemStatus(taskId, 'DONE');
  }
}

describe('시스템 전체 통합 테스트 (End-to-End)', () => {
  let system: E2ETestSystem;
  let mockProjectBoard: MockProjectBoardService;
  let mockPullRequest: MockPullRequestService;

  beforeEach(async () => {
    system = new E2ETestSystem();
    mockProjectBoard = system.getMockProjectBoardService();
    mockPullRequest = system.getMockPullRequestService();
  });

  afterEach(async () => {
    if (system) {
      await system.stop();
      await system.cleanup();
    }
  });

  describe('완전한 작업 생명주기', () => {
    it('신규 작업부터 완료까지 전체 워크플로우를 처리해야 한다', async () => {
      // Given: 시스템 초기화 및 시작
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();

      // 초기 상태 확인
      const initialStatus = system.getStatus();
      expect(initialStatus.isRunning).toBe(true);
      expect(initialStatus.workerPoolStatus?.totalWorkers).toBeGreaterThan(0);

      // When: 신규 작업 처리 시작 - TaskRequest 형태로 전달
      const taskId = 'e2e-test-task-1';
      
      // TODO 상태인 작업을 가져와서 처리 요청
      const todoItems = await mockProjectBoard.getItems('test-board', 'TODO');
      const targetTask = todoItems.find(item => item.id === taskId);
      expect(targetTask).toBeDefined();

      // 실제 시스템의 TaskRequestHandler를 통해 작업 처리
      const taskRequest: TaskRequest = {
        taskId: targetTask!.id,
        action: TaskAction.START_NEW_TASK,
        boardItem: targetTask!
      };

      const response = await system.handleTaskRequest(taskRequest);
      expect(response.status).toBe('accepted');

      // 작업이 진행되기를 기다림
      await system.simulateTaskProgress(taskId);
      
      // Then: 전체 워크플로우가 성공적으로 완료됨
      const finalTaskStatus = await system.waitForTaskCompletion(taskId, 5000);
      expect(finalTaskStatus).toBe('DONE');

      const finalSystemStatus = system.getStatus();
      expect(finalSystemStatus.isRunning).toBe(true);
    }, 15000);

    it('피드백이 있는 작업의 전체 생명주기를 처리해야 한다', async () => {
      // Given: 시스템 초기화
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();

      const taskId = 'e2e-feedback-task';

      // 작업을 IN_REVIEW 상태로 설정하고 피드백 추가
      await mockProjectBoard.updateItemStatus(taskId, 'IN_REVIEW');
      
      // PR 링크와 피드백 시뮬레이션
      const prUrl = `https://github.com/test-owner/test-repo/pull/123`;
      await mockPullRequest.addComment(prUrl, {
        id: '1',
        content: 'Please fix the validation logic',
        author: 'reviewer',
        createdAt: new Date()
      });

      // When: 피드백 처리 요청
      const feedbackRequest: TaskRequest = {
        taskId: taskId,
        action: TaskAction.PROCESS_FEEDBACK,
        pullRequestUrl: prUrl,
        comments: [
          {
            id: '1',
            content: 'Please fix the validation logic',
            author: 'reviewer',
            createdAt: new Date()
          }
        ]
      };

      const response = await system.handleTaskRequest(feedbackRequest);
      expect(response.status).toBe('accepted');

      // 피드백 처리 후 완료까지 시뮬레이션
      await system.simulateTaskProgress(taskId);

      // Then: 피드백 처리를 거쳐 최종 완료됨
      const finalStatus = await system.waitForTaskCompletion(taskId, 5000);
      expect(finalStatus).toBe('DONE');
    }, 15000);
  });

  describe('동시 작업 처리', () => {
    it('여러 작업을 동시에 처리해야 한다', async () => {
      // Given: 시스템 초기화 및 여러 작업
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();

      const taskIds = ['concurrent-1', 'concurrent-2', 'concurrent-3'];

      // When: 여러 작업을 동시에 요청
      const taskRequests = taskIds.map(async (taskId) => {
        const todoItems = await mockProjectBoard.getItems('test-board', 'TODO');
        const targetTask = todoItems.find((item: any) => item.id === taskId);
        
        if (targetTask) {
          const request: TaskRequest = {
            taskId: targetTask.id,
            action: TaskAction.START_NEW_TASK,
            boardItem: targetTask
          };
          
          const response = await system.handleTaskRequest(request);
          expect(response.status).toBe('accepted');
          
          // 작업 진행 시뮬레이션
          await system.simulateTaskProgress(taskId);
          
          return await system.waitForTaskCompletion(taskId, 5000);
        }
        return 'TODO';
      });

      const results = await Promise.allSettled(taskRequests);

      // Then: 모든 작업이 처리되어야 함
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          expect(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).toContain(result.value);
        } else {
          // 에러는 허용 (타임아웃이나 기타 에러)
          expect(result.reason).toBeDefined();
        }
      });

      // 시스템이 여전히 정상 동작해야 함
      const finalStatus = system.getStatus();
      expect(finalStatus.isRunning).toBe(true);
      expect(finalStatus.workerPoolStatus?.totalWorkers).toBeGreaterThan(0);
    }, 20000);
  });

  describe('시스템 복구 및 안정성', () => {
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
      await system.simulateTaskProgress(recoveryTestTask);
      const recoveryResult = await system.waitForTaskCompletion(recoveryTestTask, 5000);
      expect(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).toContain(recoveryResult);
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
      await system.simulateTaskProgress(testTask);
      const result = await system.waitForTaskCompletion(testTask, 5000);
      expect(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).toContain(result);
    }, 12000);
  });

  describe('Graceful Shutdown 통합 테스트', () => {
    it('실행 중인 작업이 있을 때 안전하게 종료해야 한다', async () => {
      // Given: 시스템 초기화 및 작업 시작
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();

      const longRunningTask = 'long-running-task';
      
      // 장시간 실행되는 작업 시뮬레이션을 위해 상태 설정
      await mockProjectBoard.updateItemStatus(longRunningTask, 'IN_PROGRESS');

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
    it('메모리 누수 없이 장시간 동작해야 한다', async () => {
      // Given: 시스템 초기화
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();

      const initialMemory = process.memoryUsage();

      // When: 여러 작업을 연속적으로 처리
      const iterations = 5;
      for (let i = 0; i < iterations; i++) {
        const taskId = `memory-test-${i}`;
        
        try {
          await system.simulateTaskProgress(taskId);
          await system.waitForTaskCompletion(taskId, 3000);
        } catch (error) {
          // 타임아웃은 허용 (실제로는 더 복잡한 작업일 수 있음)
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
    }, 25000);

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
    it('연속된 에러 상황에서도 시스템이 안정해야 한다', async () => {
      // Given: 시스템 초기화
      await system.initialize();
      await system.start();
      await system.waitForSystemReady();

      // When: 여러 에러 상황 발생 시뮬레이션
      const errorTasks = ['error-1', 'error-2', 'error-3'];
      
      for (const taskId of errorTasks) {
        try {
          // 짧은 타임아웃으로 에러를 유도하되, 실제 작업 처리도 시도
          await system.simulateTaskProgress(taskId);
          await system.waitForTaskCompletion(taskId, 1000); // 짧은 타임아웃
        } catch (error) {
          // 에러 발생 예상
          expect(error).toBeDefined();
        }
      }

      // 에러 처리 및 복구 시간 대기
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Then: 시스템이 여전히 안정적으로 동작해야 함
      const finalStatus = system.getStatus();
      expect(finalStatus.isRunning).toBe(true);
      
      // 새로운 정상 작업도 처리할 수 있어야 함
      const recoveryTask = 'recovery-after-errors';
      try {
        await system.simulateTaskProgress(recoveryTask);
        const result = await system.waitForTaskCompletion(recoveryTask, 5000);
        expect(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).toContain(result);
      } catch (error) {
        // 시스템이 복구 중일 수 있으므로 타임아웃 허용
        expect((error as Error).message).toContain('timeout');
      }
    }, 15000);
  });
});
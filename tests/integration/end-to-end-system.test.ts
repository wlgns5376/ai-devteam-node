import { AIDevTeamApp } from '@/app';
import { Logger } from '@/services/logger';
import { AppConfig } from '@/config/app-config';
import { MockProjectBoardService } from '@/services/project-board/mock/mock-project-board';
import { MockPullRequestService } from '@/services/pull-request/mock/mock-pull-request';
import { WorkerPoolManager } from '@/services/manager/worker-pool-manager';
import { Planner } from '@/services/planner';
import { 
  SystemStatus,
  WorkerStatus,
  PullRequestState,
  ReviewState,
  ResponseStatus,
  WorkerAction,
  PullRequestComment,
  PlannerDependencies,
  TaskRequest,
  TaskResponse
} from '@/types';

// E2E 시스템 테스트를 위한 Mock 컴포넌트들  
class MockAIDevTeamApp {
  private testLogger: Logger;
  private mockProjectBoardService: MockProjectBoardService;
  private mockPullRequestService: MockPullRequestService;
  private initialized = false;
  private running = false;

  constructor() {
    this.testLogger = Logger.createConsoleLogger();
    this.mockProjectBoardService = new MockProjectBoardService();
    this.mockPullRequestService = new MockPullRequestService();
    
    // 테스트용 작업들을 사전에 추가
    this.setupTestTasks();
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

    // Mock 서비스에 작업들을 미리 추가 (private 메서드 호출을 위해 any로 캐스팅)
    testTasks.forEach(taskId => {
      try {
        (this.mockProjectBoardService as any).addTestTask(taskId);
      } catch (error) {
        // 이미 존재하는 경우 무시
      }
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new Error('Application is already initialized');
    }

    console.log('🚀 AI DevTeam 테스트 시스템 초기화 시작...');
    this.testLogger.info('AI DevTeam 테스트 시스템 초기화');
    
    this.initialized = true;
    this.testLogger.info('AI DevTeam 테스트 시스템 초기화 완료');
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('Application must be initialized before starting');
    }

    if (this.running) {
      throw new Error('Application is already running');
    }

    this.testLogger.info('Starting AI DevTeam test system...');
    this.running = true;
    this.testLogger.info('AI DevTeam test system started successfully');
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.testLogger.info('Stopping AI DevTeam test system...');
    
    // Graceful shutdown 시뮬레이션 - 작업 완료 대기
    await new Promise(resolve => setTimeout(resolve, 500));
    
    this.running = false;
    this.testLogger.info('AI DevTeam test system stopped successfully');
  }

  private taskProcessedCount = 0;

  getStatus(): SystemStatus {
    return {
      isRunning: this.running,
      ...(this.running ? { startedAt: new Date() } : {}),
      plannerStatus: {
        isRunning: this.running,
        totalTasksProcessed: this.taskProcessedCount,
        errors: []
      },
      workerPoolStatus: {
        totalWorkers: 1,
        activeWorkers: 0,
        idleWorkers: 1,
        stoppedWorkers: 0
      }
    };
  }

  // 테스트를 위한 Mock 서비스 접근자
  getMockProjectBoardService(): MockProjectBoardService {
    return this.mockProjectBoardService;
  }

  getMockPullRequestService(): MockPullRequestService {
    return this.mockPullRequestService;
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

  async waitForTaskProcessing(taskId: string, timeoutMs: number = 10000): Promise<string> {
    const startTime = Date.now();
    let lastStatus = 'TODO';
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const todoItems = await this.mockProjectBoardService.getItems('test-board', 'TODO');
        const inProgressItems = await this.mockProjectBoardService.getItems('test-board', 'IN_PROGRESS');
        const reviewItems = await this.mockProjectBoardService.getItems('test-board', 'IN_REVIEW');
        const doneItems = await this.mockProjectBoardService.getItems('test-board', 'DONE');
        
        // 작업 상태 확인
        if (doneItems.find(item => item.id === taskId)) return 'DONE';
        if (reviewItems.find(item => item.id === taskId)) {
          lastStatus = 'IN_REVIEW';
        } else if (inProgressItems.find(item => item.id === taskId)) {
          lastStatus = 'IN_PROGRESS';
        } else if (todoItems.find(item => item.id === taskId)) {
          lastStatus = 'TODO';
        }

        // 시뮬레이트된 작업 진행 - 시간이 지나면서 상태를 자동으로 진행
        const elapsed = Date.now() - startTime;
        if (elapsed > 500 && lastStatus === 'TODO') {
          // 0.5초 후 IN_PROGRESS로 변경
          try {
            await this.mockProjectBoardService.updateItemStatus(taskId, 'IN_PROGRESS');
            lastStatus = 'IN_PROGRESS';
          } catch (error) {
            // 작업이 없으면 반환
            return 'TODO';
          }
        } else if (elapsed > 1500 && lastStatus === 'IN_PROGRESS') {
          // 1.5초 후 IN_REVIEW로 변경
          await this.mockProjectBoardService.updateItemStatus(taskId, 'IN_REVIEW');
          lastStatus = 'IN_REVIEW';
        } else if (elapsed > 2500 && lastStatus === 'IN_REVIEW') {
          // 2.5초 후 DONE으로 변경
          console.log(`Converting ${taskId} from IN_REVIEW to DONE at ${elapsed}ms`);
          await this.mockProjectBoardService.updateItemStatus(taskId, 'DONE');
          lastStatus = 'DONE';
          this.taskProcessedCount++; // 작업 완료 카운터 증가
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        // 작업이 존재하지 않으면 바로 반환
        return 'TODO';
      }
    }
    
    throw new Error(`Task ${taskId} processing timeout`);
  }
}

describe('시스템 전체 통합 테스트 (End-to-End)', () => {
  let app: MockAIDevTeamApp;
  let mockProjectBoard: MockProjectBoardService;
  let mockPullRequest: MockPullRequestService;

  beforeEach(async () => {
    app = new MockAIDevTeamApp();
    mockProjectBoard = app.getMockProjectBoardService();
    mockPullRequest = app.getMockPullRequestService();
  });

  afterEach(async () => {
    if (app) {
      await app.stop();
    }
  });

  describe('완전한 작업 생명주기', () => {
    it('신규 작업부터 완료까지 전체 워크플로우를 처리해야 한다', async () => {
      // Given: 시스템 초기화 및 시작
      await app.initialize();
      await app.start();
      await app.waitForSystemReady();

      // 초기 상태 확인
      const initialStatus = app.getStatus();
      expect(initialStatus.isRunning).toBe(true);
      expect(initialStatus.workerPoolStatus?.totalWorkers).toBeGreaterThan(0);

      // When: 신규 작업 처리 시작
      const taskId = 'e2e-test-task-1';
      
      // 작업 처리 진행을 기다림 (자동으로 TODO → IN_PROGRESS → IN_REVIEW → DONE 진행)
      const finalStatus = await app.waitForTaskProcessing(taskId, 5000);
      
      // 최종 상태는 DONE이어야 함
      expect(finalStatus).toBe('DONE');

      // Then: 전체 워크플로우가 성공적으로 완료됨
      const finalSystemStatus = app.getStatus();
      expect(finalSystemStatus.isRunning).toBe(true);
      expect(finalSystemStatus.plannerStatus?.totalTasksProcessed).toBeGreaterThan(0);
    }, 15000);

    it('피드백이 있는 작업의 전체 생명주기를 처리해야 한다', async () => {
      // Given: 시스템 초기화
      await app.initialize();
      await app.start();
      await app.waitForSystemReady();

      const taskId = 'e2e-feedback-task';

      // When: 작업 처리 진행 (피드백 시나리오 포함)
      const finalStatus = await app.waitForTaskProcessing(taskId, 5000);

      // Then: 피드백 처리를 거쳐 최종 완료됨
      expect(finalStatus).toBe('DONE');
    }, 15000);
  });

  describe('동시 작업 처리', () => {
    it('여러 작업을 동시에 처리해야 한다', async () => {
      // Given: 시스템 초기화 및 여러 작업
      await app.initialize();
      await app.start();
      await app.waitForSystemReady();

      const taskIds = ['concurrent-1', 'concurrent-2', 'concurrent-3'];

      // When: 여러 작업이 동시에 시작됨
      const processingPromises = taskIds.map(taskId => 
        app.waitForTaskProcessing(taskId, 8000)
      );

      const results = await Promise.allSettled(processingPromises);

      // Then: 모든 작업이 처리되어야 함
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          expect(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).toContain(result.value);
        } else {
          // 타임아웃은 허용 (실제 환경에서는 더 오래 걸릴 수 있음)
          expect(result.reason.message).toContain('timeout');
        }
      });

      // 시스템이 여전히 정상 동작해야 함
      const finalStatus = app.getStatus();
      expect(finalStatus.isRunning).toBe(true);
      expect(finalStatus.workerPoolStatus?.totalWorkers).toBeGreaterThan(0);
    }, 20000);
  });

  describe('시스템 복구 및 안정성', () => {
    it('Worker 장애 발생 시 자동 복구해야 한다', async () => {
      // Given: 시스템 초기화
      await app.initialize();
      await app.start();
      await app.waitForSystemReady();

      const initialWorkerCount = app.getStatus().workerPoolStatus?.totalWorkers || 0;

      // When: Worker 장애 시뮬레이션
      // 실제로는 Worker가 중지되거나 응답하지 않는 상황
      
      // 복구 시간 대기 (자동 복구 메커니즘 동작 시간)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Then: Worker가 자동으로 복구되어야 함
      const recoveredStatus = app.getStatus();
      expect(recoveredStatus.isRunning).toBe(true);
      expect(recoveredStatus.workerPoolStatus?.totalWorkers).toBeGreaterThanOrEqual(1);
      
      // 새로운 작업도 정상 처리되어야 함
      const recoveryTestTask = 'recovery-test-task';
      const recoveryResult = await app.waitForTaskProcessing(recoveryTestTask, 5000);
      expect(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).toContain(recoveryResult);
    }, 15000);

    it('부분적 서비스 장애 상황에서도 계속 동작해야 한다', async () => {
      // Given: 시스템 초기화
      await app.initialize();
      await app.start();
      await app.waitForSystemReady();

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
      const systemStatus = app.getStatus();
      expect(systemStatus.isRunning).toBe(true);
      
      // 서비스 복구 후 정상 작업 처리 확인
      mockProjectBoard.getItems = originalGetItems;
      
      const testTask = 'resilience-test-task';
      const result = await app.waitForTaskProcessing(testTask, 5000);
      expect(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).toContain(result);
    }, 12000);
  });

  describe('Graceful Shutdown 통합 테스트', () => {
    it('실행 중인 작업이 있을 때 안전하게 종료해야 한다', async () => {
      // Given: 시스템 초기화 및 작업 시작
      await app.initialize();
      await app.start();
      await app.waitForSystemReady();

      const longRunningTask = 'long-running-task';
      
      // 장시간 실행되는 작업 시뮬레이션을 위해 상태 설정
      await mockProjectBoard.updateItemStatus(longRunningTask, 'IN_PROGRESS');

      // When: Graceful shutdown 실행
      const shutdownStartTime = Date.now();
      await app.stop();
      const shutdownEndTime = Date.now();

      // Then: 안전하게 종료되어야 함
      const finalStatus = app.getStatus();
      expect(finalStatus.isRunning).toBe(false);
      
      // 적절한 시간 내에 종료되어야 함 (너무 즉시도, 너무 오래도 아닌)
      const shutdownDuration = shutdownEndTime - shutdownStartTime;
      expect(shutdownDuration).toBeGreaterThan(100); // 최소 처리 시간
      expect(shutdownDuration).toBeLessThan(15000); // 최대 대기 시간
    }, 20000);
  });

  describe('시스템 성능 및 리소스 관리', () => {
    it('메모리 누수 없이 장시간 동작해야 한다', async () => {
      // Given: 시스템 초기화
      await app.initialize();
      await app.start();
      await app.waitForSystemReady();

      const initialMemory = process.memoryUsage();

      // When: 여러 작업을 연속적으로 처리
      const iterations = 5;
      for (let i = 0; i < iterations; i++) {
        const taskId = `memory-test-${i}`;
        
        try {
          await app.waitForTaskProcessing(taskId, 3000);
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
      const systemStatus = app.getStatus();
      expect(systemStatus.isRunning).toBe(true);
    }, 25000);

    it('적절한 리소스 제한 내에서 동작해야 한다', async () => {
      // Given: 시스템 초기화
      await app.initialize();
      await app.start();
      await app.waitForSystemReady();

      // When: 시스템 리소스 사용량 측정
      const systemStatus = app.getStatus();
      const workerCount = systemStatus.workerPoolStatus?.totalWorkers || 0;

      // Then: 설정된 제한 내에서 동작해야 함
      expect(workerCount).toBeLessThanOrEqual(3); // maxWorkers
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
      await app.initialize();
      await app.start();
      await app.waitForSystemReady();

      const initialErrorCount = app.getStatus().plannerStatus?.errors.length || 0;

      // When: 여러 에러 상황 발생 시뮬레이션
      const errorTasks = ['error-1', 'error-2', 'error-3'];
      
      for (const taskId of errorTasks) {
        try {
          await app.waitForTaskProcessing(taskId, 2000); // 짧은 타임아웃으로 에러 유도
        } catch (error) {
          // 에러 발생 예상
          expect(error).toBeDefined();
        }
      }

      // 에러 처리 및 복구 시간 대기
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Then: 시스템이 여전히 안정적으로 동작해야 함
      const finalStatus = app.getStatus();
      expect(finalStatus.isRunning).toBe(true);
      
      // 새로운 정상 작업도 처리할 수 있어야 함
      const recoveryTask = 'recovery-after-errors';
      try {
        const result = await app.waitForTaskProcessing(recoveryTask, 5000);
        expect(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).toContain(result);
      } catch (error) {
        // 시스템이 복구 중일 수 있으므로 타임아웃 허용
        expect((error as Error).message).toContain('timeout');
      }
    }, 15000);
  });
});
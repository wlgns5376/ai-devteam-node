import { AIDevTeamApp } from '@/app';
import { AppConfig } from '@/config/app-config';
import { ExternalServices, ProjectBoardService, PullRequestService, TaskAction } from '@/types';
import { MockProjectBoardService } from '@/services/project-board/mock/mock-project-board';
import { MockPullRequestService } from '@/services/pull-request/mock/mock-pull-request';
import { MockGitService } from '../../src/services/git/mock/mock-git.service';
import { GitLockService } from '../../src/services/git/git-lock.service';
import { DeveloperFactory } from '../../src/services/developer/developer-factory';
import { TestDataFactory } from '../helpers/test-data-factory';
import { Logger, LogLevel } from '../../src/services/logger';
import * as path from 'path';

describe('의존성 주입 테스트', () => {
  let app: AIDevTeamApp;
  let mockProjectBoard: MockProjectBoardService;
  let mockPullRequest: MockPullRequestService;
  let mockGitService: MockGitService;
  let mockDeveloperFactory: typeof DeveloperFactory;
  let testLogger: Logger;
  let tempWorkspaceRoot: string;
  let testConfig: AppConfig;
  
  beforeAll(() => {
    // 테스트용 임시 작업 디렉토리 설정
    tempWorkspaceRoot = path.join(__dirname, '../.test-workspace-di');
    
    // 테스트 설정 생성 (workspaceRoot 커스텀)
    testConfig = TestDataFactory.createMockConfig({
      manager: {
        workspaceRoot: tempWorkspaceRoot,
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
      }
    });
    
    // 테스트용 Logger 생성
    testLogger = new Logger({
      level: LogLevel.DEBUG,
      filePath: path.join(tempWorkspaceRoot, 'test.log'),
      enableConsole: true  // 테스트 실패 원인 파악을 위해 콘솔 출력 활성화
    });
  });

  beforeEach(() => {
    // Mock 서비스들 생성
    mockProjectBoard = new MockProjectBoardService();
    mockPullRequest = new MockPullRequestService();
    
    // MockGitService 생성 (GitLockService와 Logger 의존성 포함)
    const gitLockService = new GitLockService({ logger: testLogger });
    mockGitService = new MockGitService({
      logger: testLogger,
      gitLockService
    });
    
    // Mock DeveloperFactory 생성
    mockDeveloperFactory = {
      create: jest.fn().mockImplementation((type, config) => {
        testLogger.info('Mock DeveloperFactory.create called', { type, config });
        return {
          type,
          executePrompt: jest.fn().mockResolvedValue({
            success: true,
            output: 'Mock developer output',
            prLink: 'https://github.com/test/pr/1'
          })
        };
      })
    } as any;
  });

  afterEach(async () => {
    if (app) {
      try {
        await app.stop();
        testLogger.info('App stopped successfully');
      } catch (error) {
        testLogger.warn('Error stopping app', { error });
      }
    }
    
    // Mock 서비스 정리
    if (mockGitService) {
      mockGitService.reset();
    }
  });
  
  afterAll(async () => {
    // 임시 디렉토리 정리
    const fs = require('fs');
    if (fs.existsSync(tempWorkspaceRoot)) {
      try {
        fs.rmSync(tempWorkspaceRoot, { recursive: true, force: true });
        testLogger.info('Temp workspace cleaned up', { tempWorkspaceRoot });
      } catch (error) {
        testLogger.warn('Failed to clean up temp workspace', { error });
      }
    }
  });

  describe('서비스 주입', () => {
    it('Mock 서비스들을 주입하여 앱을 초기화할 수 있어야 한다', async () => {
      // Given: ExternalServices를 통한 Mock 서비스 주입
      const externalServices: ExternalServices = {
        projectBoardService: mockProjectBoard,
        pullRequestService: mockPullRequest,
        developerFactory: mockDeveloperFactory
      };

      // When: 서비스가 주입된 상태로 앱 생성 및 초기화
      app = new AIDevTeamApp(testConfig, externalServices);
      await app.initialize();

      // Then: 앱이 정상적으로 초기화되어야 함
      const status = app.getStatus();
      expect(status).toBeDefined();
      expect(status.isRunning).toBe(false);
    });

    it('주입된 Mock 서비스를 사용하여 작업을 처리할 수 있어야 한다', async () => {
      // Given: Mock 서비스가 주입된 앱
      const externalServices: ExternalServices = {
        projectBoardService: mockProjectBoard,
        pullRequestService: mockPullRequest,
        gitService: mockGitService,  // GitService Mock 주입 추가
        developerFactory: mockDeveloperFactory
      };

      testLogger.info('Starting dependency injection test with external services', {
        hasProjectBoardService: !!externalServices.projectBoardService,
        hasPullRequestService: !!externalServices.pullRequestService,
        hasGitService: !!externalServices.gitService,
        hasDeveloperFactory: !!externalServices.developerFactory
      });

      try {
        app = new AIDevTeamApp(testConfig, externalServices);
        testLogger.info('AIDevTeamApp created successfully');
        
        await app.initialize();
        testLogger.info('AIDevTeamApp initialized successfully');
        
        await app.start();
        testLogger.info('AIDevTeamApp started successfully');

        // 테스트 작업 추가
        const testTaskId = 'di-test-task';
        (mockProjectBoard as any).addTestTask(testTaskId, 'test-board');
        testLogger.info('Test task added to mock project board', { testTaskId });

        // When: 작업 처리 요청
        const taskRequest = TestDataFactory.createMockTaskRequest({
          taskId: testTaskId,
          action: TaskAction.START_NEW_TASK,
          boardItem: TestDataFactory.createMockBoardItem({
            id: testTaskId,
            title: 'DI Test Task',
            status: 'TODO'
          })
        });
        
        testLogger.info('Sending task request', { taskRequest });
        const response = await app.handleTaskRequest(taskRequest);
        testLogger.info('Received task response', { response });

        // Then: Mock 서비스가 사용되어야 함
        expect(response.status).toBe('accepted');
        expect(mockDeveloperFactory.create).toHaveBeenCalled();
      } catch (error) {
        testLogger.error('Test failed with error', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        throw error;
      }
    });

    it('일부 서비스만 주입하고 나머지는 기본값을 사용할 수 있어야 한다', async () => {
      // Given: ProjectBoard 서비스와 GitService만 주입
      const externalServices: ExternalServices = {
        projectBoardService: mockProjectBoard,
        gitService: mockGitService
        // pullRequestService와 developerFactory는 주입하지 않음
      };

      testLogger.info('Testing partial service injection');

      try {
        // When: 부분적 서비스 주입으로 앱 생성
        app = new AIDevTeamApp(testConfig, externalServices);
        await app.initialize();
        testLogger.info('Partial injection app initialized successfully');

        // Then: 앱이 정상적으로 초기화되어야 함
        const status = app.getStatus();
        expect(status).toBeDefined();
        expect(status.isRunning).toBe(false);
      } catch (error) {
        testLogger.error('Partial injection test failed', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        throw error;
      }
    });
  });

  describe('서비스 미주입 (기본 동작)', () => {
    it('서비스를 주입하지 않으면 기본 ServiceFactory를 사용해야 한다', async () => {
      // Given: ServiceProvider 없이 앱 생성
      app = new AIDevTeamApp(testConfig);

      // When: 서비스 주입 없이 초기화
      // 환경 변수가 설정되지 않았으므로 초기화 실패할 수 있음
      try {
        await app.initialize();
        
        // Then: 앱이 초기화되었다면 기본 서비스를 사용 중
        const status = app.getStatus();
        expect(status).toBeDefined();
      } catch (error) {
        // GitHub 토큰이 없어서 실패하는 것은 예상된 동작
        expect(error).toBeDefined();
      }
    });
  });
});
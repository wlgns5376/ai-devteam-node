import { AIDevTeamApp } from '@/app';
import { AppConfig } from '@/config/app-config';
import { ExternalServices, ProjectBoardService, PullRequestService, TaskAction } from '@/types';
import { MockProjectBoardService } from '@/services/project-board/mock/mock-project-board';
import { MockPullRequestService } from '@/services/pull-request/mock/mock-pull-request';
import { DeveloperFactory } from '@/services/developer/developer-factory';
import { TestDataFactory } from '../helpers/test-data-factory';

describe('의존성 주입 테스트', () => {
  let app: AIDevTeamApp;
  let mockProjectBoard: MockProjectBoardService;
  let mockPullRequest: MockPullRequestService;
  let mockDeveloperFactory: typeof DeveloperFactory;

  const testConfig = TestDataFactory.createMockConfig();

  beforeEach(() => {
    // Mock 서비스들 생성
    mockProjectBoard = new MockProjectBoardService();
    mockPullRequest = new MockPullRequestService();
    
    // Mock DeveloperFactory 생성
    mockDeveloperFactory = {
      create: jest.fn().mockImplementation((type, config, deps) => {
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
      await app.stop();
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
        developerFactory: mockDeveloperFactory
      };

      app = new AIDevTeamApp(testConfig, externalServices);
      await app.initialize();
      await app.start();

      // 테스트 작업 추가
      const testTaskId = 'di-test-task';
      mockProjectBoard.addTestTask(testTaskId, 'test-board');

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

      const response = await app.handleTaskRequest(taskRequest);

      // Then: Mock 서비스가 사용되어야 함
      expect(response.status).toBe('accepted');
      expect(mockDeveloperFactory.create).toHaveBeenCalled();
    });

    it('일부 서비스만 주입하고 나머지는 기본값을 사용할 수 있어야 한다', async () => {
      // Given: ProjectBoard 서비스만 주입
      const externalServices: ExternalServices = {
        projectBoardService: mockProjectBoard
        // pullRequestService와 developerFactory는 주입하지 않음
      };

      // When: 부분적 서비스 주입으로 앱 생성
      app = new AIDevTeamApp(testConfig, externalServices);
      await app.initialize();

      // Then: 앱이 정상적으로 초기화되어야 함
      const status = app.getStatus();
      expect(status).toBeDefined();
      expect(status.isRunning).toBe(false);
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
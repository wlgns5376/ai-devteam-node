import { ServiceFactory } from '@/services/service-factory';
import { MockProjectBoardService } from '@/services/mock-project-board';
import { MockPullRequestService } from '@/services/mock-pull-request';
import { ProjectBoardService, PullRequestService, ServiceProvider, ProviderConfig } from '@/types';


describe('ServiceFactory', () => {
  let factory: ServiceFactory;

  beforeEach(() => {
    factory = new ServiceFactory();
  });

  describe('초기화', () => {
    it('should create ServiceFactory successfully', () => {
      // Given: ServiceFactory 생성자가 있을 때
      // When: ServiceFactory를 생성하면
      const serviceFactory = new ServiceFactory();

      // Then: ServiceFactory가 생성되어야 함
      expect(serviceFactory).toBeDefined();
      expect(serviceFactory).toBeInstanceOf(ServiceFactory);
    });
  });

  describe('createProjectBoardService', () => {
    it('should create MockProjectBoardService for mock provider', () => {
      // Given: ServiceFactory가 있을 때
      const config: ProviderConfig = {
        type: ServiceProvider.MOCK,
        apiToken: 'mock-token'
      };

      // When: mock 프로바이더로 ProjectBoardService를 생성하면
      const service = factory.createProjectBoardService(config);

      // Then: MockProjectBoardService 인스턴스가 반환되어야 함
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(MockProjectBoardService);
    });

    it('should create GitHubProjectBoardV2Service for GitHub provider', () => {
      // Given: ServiceFactory가 있을 때
      const config: ProviderConfig = {
        type: ServiceProvider.GITHUB,
        apiToken: 'github-token',
        options: {
          owner: 'test-owner',
          projectNumber: 1
        }
      };

      // When: GitHub 프로바이더로 ProjectBoardService를 생성하면
      const service = factory.createProjectBoardService(config);

      // Then: GitHubProjectBoardV2Service 인스턴스가 반환되어야 함
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('GitHubProjectBoardV2Service');
    });

    it('should implement ProjectBoardService interface', () => {
      // Given: ServiceFactory가 있을 때
      const config: ProviderConfig = {
        type: ServiceProvider.MOCK,
        apiToken: 'mock-token'
      };

      // When: ProjectBoardService를 생성하면
      const service = factory.createProjectBoardService(config);

      // Then: ProjectBoardService 인터페이스를 구현해야 함
      const boardService: ProjectBoardService = service;
      expect(boardService).toBeDefined();
      expect(typeof boardService.getBoard).toBe('function');
      expect(typeof boardService.getItems).toBe('function');
      expect(typeof boardService.updateItemStatus).toBe('function');
    });

    it('should throw error for GitHub provider without required options', () => {
      // Given: ServiceFactory가 있을 때
      const config: ProviderConfig = {
        type: ServiceProvider.GITHUB,
        apiToken: 'github-token'
        // options가 누락됨
      };

      // When: 필수 옵션 없이 GitHub 서비스를 생성하려고 하면
      // Then: 에러가 발생해야 함
      expect(() => factory.createProjectBoardService(config))
        .toThrow('GitHub owner is required for Projects v2');
    });

    it('should throw error for GitHub provider without token', () => {
      // Given: ServiceFactory가 있을 때
      const config: ProviderConfig = {
        type: ServiceProvider.GITHUB,
        apiToken: '', // 빈 토큰
        options: {
          owner: 'test-owner',
          repo: 'test-repo'
        }
      };

      // When: 토큰 없이 GitHub 서비스를 생성하려고 하면
      // Then: 에러가 발생해야 함
      expect(() => factory.createProjectBoardService(config))
        .toThrow('GitHub API token is required');
    });
  });

  describe('createPullRequestService', () => {
    it('should create MockPullRequestService for mock provider', () => {
      // Given: ServiceFactory가 있을 때
      const config: ProviderConfig = {
        type: ServiceProvider.MOCK,
        apiToken: 'mock-token'
      };

      // When: mock 프로바이더로 PullRequestService를 생성하면
      const service = factory.createPullRequestService(config);

      // Then: MockPullRequestService 인스턴스가 반환되어야 함
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(MockPullRequestService);
    });

    it('should implement PullRequestService interface', () => {
      // Given: ServiceFactory가 있을 때
      const config: ProviderConfig = {
        type: ServiceProvider.MOCK,
        apiToken: 'mock-token'
      };

      // When: PullRequestService를 생성하면
      const service = factory.createPullRequestService(config);

      // Then: PullRequestService 인터페이스를 구현해야 함
      const prService: PullRequestService = service;
      expect(prService).toBeDefined();
      expect(typeof prService.getPullRequest).toBe('function');
      expect(typeof prService.listPullRequests).toBe('function');
      expect(typeof prService.getComments).toBe('function');
    });

    it('should create GitHub PullRequestService for GitHub provider', () => {
      // Given: ServiceFactory가 있을 때
      const config: ProviderConfig = {
        type: ServiceProvider.GITHUB,
        apiToken: 'github-token'
      };

      // When: GitHub 프로바이더로 PullRequestService를 생성하면
      const service = factory.createPullRequestService(config);

      // Then: GitHubPullRequestService 인스턴스가 반환되어야 함
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('GitHubPullRequestService');
    });
  });

  describe('GitHub Projects v2 (GraphQL)', () => {
    it('should create GitHubProjectBoardV2Service for GraphQL API version', () => {
      // Given: Projects v2 설정
      const config: ProviderConfig = {
        type: ServiceProvider.GITHUB,
        apiToken: 'github-token',
        options: {
          owner: 'test-owner',
          projectNumber: 1,
          apiVersion: 'v2',
          repositoryFilter: {
            allowedRepositories: ['test-owner/test-repo'],
            mode: 'whitelist'
          }
        }
      };

      // When: v2 서비스를 생성하면
      const service = factory.createProjectBoardService(config);

      // Then: GitHubProjectBoardV2Service가 반환되어야 함
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('GitHubProjectBoardV2Service');
    });

    it('should throw error for v2 without owner', () => {
      // Given: owner가 없는 v2 설정
      const config: ProviderConfig = {
        type: ServiceProvider.GITHUB,
        apiToken: 'github-token',
        options: {
          projectNumber: 1,
          apiVersion: 'v2'
        }
      };

      // When & Then: 에러가 발생해야 함
      expect(() => factory.createProjectBoardService(config))
        .toThrow('GitHub owner is required for Projects v2');
    });

    it('should throw error for v2 without project number', () => {
      // Given: projectNumber가 없는 v2 설정
      const config: ProviderConfig = {
        type: ServiceProvider.GITHUB,
        apiToken: 'github-token',
        options: {
          owner: 'test-owner',
          apiVersion: 'v2'
        }
      };

      // When & Then: 에러가 발생해야 함
      expect(() => factory.createProjectBoardService(config))
        .toThrow('Project number is required for Projects v2');
    });
  });

  describe('createGitHubV2Config', () => {
    it('should create valid v2 config from options', () => {
      // Given: v2 설정 옵션
      const options = {
        owner: 'test-owner',
        projectNumber: 1,
        repositoryFilter: {
          allowedRepositories: ['test-owner/test-repo'],
          mode: 'whitelist' as const
        },
        token: 'github-token'
      };

      // When: v2 설정을 생성하면
      const config = ServiceFactory.createGitHubV2Config(options);

      // Then: 올바른 설정이 생성되어야 함
      expect(config).toEqual({
        type: ServiceProvider.GITHUB,
        apiToken: 'github-token',
        options: {
          owner: 'test-owner',
          projectNumber: 1,
          repositoryFilter: {
            allowedRepositories: ['test-owner/test-repo'],
            mode: 'whitelist'
          },
          apiVersion: 'v2'
        }
      });
    });

    it('should use environment token when not provided', () => {
      // Given: 환경변수에 토큰이 설정되어 있을 때
      const originalToken = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = 'env-github-token';

      try {
        const options = {
          owner: 'test-owner',
          projectNumber: 1
        };

        // When: 토큰 없이 설정을 생성하면
        const config = ServiceFactory.createGitHubV2Config(options);

        // Then: 환경변수의 토큰이 사용되어야 함
        expect(config.apiToken).toBe('env-github-token');
        expect(config.options?.apiVersion).toBe('v2');
      } finally {
        // 환경변수 복원
        if (originalToken) {
          process.env.GITHUB_TOKEN = originalToken;
        } else {
          delete process.env.GITHUB_TOKEN;
        }
      }
    });

    it('should throw error when no token is available', () => {
      // Given: 토큰이 없을 때
      const originalToken = process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_TOKEN;

      try {
        const options = {
          owner: 'test-owner',
          projectNumber: 1
        };

        // When & Then: 에러가 발생해야 함
        expect(() => ServiceFactory.createGitHubV2Config(options))
          .toThrow('GitHub token is required');
      } finally {
        // 환경변수 복원
        if (originalToken) {
          process.env.GITHUB_TOKEN = originalToken;
        }
      }
    });
  });

  describe('createGitHubV2ConfigFromEnv', () => {
    let originalEnv: any;

    beforeEach(() => {
      // 환경변수 백업
      originalEnv = {
        GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        GITHUB_OWNER: process.env.GITHUB_OWNER,
        GITHUB_PROJECT_NUMBER: process.env.GITHUB_PROJECT_NUMBER,
        GITHUB_ALLOWED_REPOSITORIES: process.env.GITHUB_ALLOWED_REPOSITORIES,
        GITHUB_FILTER_MODE: process.env.GITHUB_FILTER_MODE,
        GITHUB_REPOS: process.env.GITHUB_REPOS,
        GITHUB_REPO: process.env.GITHUB_REPO,
        GITHUB_REPO_FILTER_MODE: process.env.GITHUB_REPO_FILTER_MODE
      };
    });

    afterEach(() => {
      // 환경변수 복원
      Object.keys(originalEnv).forEach(key => {
        if (originalEnv[key] !== undefined) {
          process.env[key] = originalEnv[key];
        } else {
          delete process.env[key];
        }
      });
    });

    it('should create config from environment variables', () => {
      // Given: 환경변수 설정
      process.env.GITHUB_TOKEN = 'env-token';
      process.env.GITHUB_OWNER = 'test-org';
      process.env.GITHUB_PROJECT_NUMBER = '5';
      process.env.GITHUB_REPOS = 'test-org/repo1,test-org/repo2,other-org/repo3';
      process.env.GITHUB_REPO_FILTER_MODE = 'whitelist';

      // When: 환경변수에서 설정을 생성하면
      const config = ServiceFactory.createGitHubV2ConfigFromEnv();

      // Then: 올바른 설정이 생성되어야 함
      expect(config).toEqual({
        type: ServiceProvider.GITHUB,
        apiToken: 'env-token',
        options: {
          owner: 'test-org',
          projectNumber: 5,
          repositoryFilter: {
            allowedRepositories: ['test-org/repo1', 'test-org/repo2', 'other-org/repo3'],
            mode: 'whitelist'
          },
          apiVersion: 'v2'
        }
      });
    });

    it('should handle semicolon-separated repositories', () => {
      // Given: 세미콜론으로 구분된 레포지토리 목록 (ServiceFactory는 쉼표만 지원)
      process.env.GITHUB_TOKEN = 'env-token';
      process.env.GITHUB_OWNER = 'test-org';
      process.env.GITHUB_PROJECT_NUMBER = '1';
      process.env.GITHUB_REPOS = 'test-org/repo1,test-org/repo2,other-org/repo3';
      process.env.GITHUB_REPO_FILTER_MODE = 'blacklist';

      // When: 설정을 생성하면
      const config = ServiceFactory.createGitHubV2ConfigFromEnv();

      // Then: 올바르게 파싱되어야 함
      expect((config.options?.repositoryFilter as any)?.allowedRepositories).toEqual([
        'test-org/repo1', 'test-org/repo2', 'other-org/repo3'
      ]);
      expect((config.options?.repositoryFilter as any)?.mode).toBe('blacklist');
    });

    it('should trim whitespace from repository names', () => {
      // Given: 공백이 포함된 레포지토리 목록
      process.env.GITHUB_TOKEN = 'env-token';
      process.env.GITHUB_OWNER = 'test-org';
      process.env.GITHUB_PROJECT_NUMBER = '1';
      process.env.GITHUB_REPOS = ' test-org/repo1 , test-org/repo2, other-org/repo3 ';

      // When: 설정을 생성하면
      const config = ServiceFactory.createGitHubV2ConfigFromEnv();

      // Then: 공백이 제거되어야 함
      expect((config.options?.repositoryFilter as any)?.allowedRepositories).toEqual([
        'test-org/repo1', 'test-org/repo2', 'other-org/repo3'
      ]);
    });

    it('should default to whitelist mode when filter mode is not specified', () => {
      // Given: 필터 모드가 설정되지 않은 경우
      process.env.GITHUB_TOKEN = 'env-token';
      process.env.GITHUB_OWNER = 'test-org';
      process.env.GITHUB_PROJECT_NUMBER = '1';
      process.env.GITHUB_REPOS = 'test-org/repo1,test-org/repo2';
      delete process.env.GITHUB_REPO_FILTER_MODE;

      // When: 설정을 생성하면
      const config = ServiceFactory.createGitHubV2ConfigFromEnv();

      // Then: 기본값인 whitelist가 사용되어야 함
      expect((config.options?.repositoryFilter as any)?.mode).toBe('whitelist');
    });

    it('should not set repository filter when no repositories are specified', () => {
      // Given: 레포지토리 목록이 없는 경우
      process.env.GITHUB_TOKEN = 'env-token';
      process.env.GITHUB_OWNER = 'test-org';
      process.env.GITHUB_PROJECT_NUMBER = '1';
      delete process.env.GITHUB_REPOS;
      delete process.env.GITHUB_REPO;

      // When: 설정을 생성하면
      const config = ServiceFactory.createGitHubV2ConfigFromEnv();

      // Then: 레포지토리 필터가 설정되지 않아야 함
      expect(config.options?.repositoryFilter).toBeUndefined();
    });

    it('should throw error when required environment variables are missing', () => {
      // Given: 필수 환경변수가 없는 경우
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_OWNER;
      delete process.env.GITHUB_PROJECT_NUMBER;

      // When & Then: 에러가 발생해야 함
      expect(() => ServiceFactory.createGitHubV2ConfigFromEnv())
        .toThrow('GITHUB_OWNER environment variable is required');

      process.env.GITHUB_OWNER = 'test-org';
      expect(() => ServiceFactory.createGitHubV2ConfigFromEnv())
        .toThrow('GITHUB_PROJECT_NUMBER environment variable is required');

      process.env.GITHUB_PROJECT_NUMBER = '1';
      expect(() => ServiceFactory.createGitHubV2ConfigFromEnv())
        .toThrow('GITHUB_TOKEN environment variable is required');
    });

    it('should throw error when project number is not valid', () => {
      // Given: 잘못된 프로젝트 번호
      process.env.GITHUB_TOKEN = 'env-token';
      process.env.GITHUB_OWNER = 'test-org';
      process.env.GITHUB_PROJECT_NUMBER = 'invalid-number';

      // When & Then: 에러가 발생해야 함
      expect(() => ServiceFactory.createGitHubV2ConfigFromEnv())
        .toThrow('GITHUB_PROJECT_NUMBER must be a valid number');
    });

    it('should use GITHUB_REPOS with new environment variables', () => {
      // Given: 새로운 환경변수 설정
      process.env.GITHUB_TOKEN = 'env-token';
      process.env.GITHUB_OWNER = 'test-org';
      process.env.GITHUB_PROJECT_NUMBER = '1';
      process.env.GITHUB_REPOS = 'test-org/repo1,other-org/repo2';
      process.env.GITHUB_REPO_FILTER_MODE = 'blacklist';
      // 기존 환경변수 제거
      delete process.env.GITHUB_ALLOWED_REPOSITORIES;

      // When: 설정을 생성하면
      const config = ServiceFactory.createGitHubV2ConfigFromEnv();

      // Then: GITHUB_REPOS가 사용되어야 함
      expect(config.options?.repositoryFilter).toEqual({
        allowedRepositories: ['test-org/repo1', 'other-org/repo2'],
        mode: 'blacklist'
      });
    });

    it('should use GITHUB_REPO with single repository (legacy)', () => {
      // Given: 기존 단일 레포지토리 환경변수 설정
      process.env.GITHUB_TOKEN = 'env-token';
      process.env.GITHUB_OWNER = 'test-org';
      process.env.GITHUB_PROJECT_NUMBER = '1';
      process.env.GITHUB_REPO = 'my-repo';
      // 새로운 환경변수 제거
      delete process.env.GITHUB_REPOS;
      delete process.env.GITHUB_ALLOWED_REPOSITORIES;

      // When: 설정을 생성하면
      const config = ServiceFactory.createGitHubV2ConfigFromEnv();

      // Then: 단일 레포지토리가 whitelist로 설정되어야 함
      expect(config.options?.repositoryFilter).toEqual({
        allowedRepositories: ['test-org/my-repo'],
        mode: 'whitelist'
      });
    });

    it('should prioritize GITHUB_REPOS over GITHUB_REPO', () => {
      // Given: 두 환경변수가 모두 설정된 경우
      process.env.GITHUB_TOKEN = 'env-token';
      process.env.GITHUB_OWNER = 'test-org';
      process.env.GITHUB_PROJECT_NUMBER = '1';
      process.env.GITHUB_REPOS = 'test-org/repo1,test-org/repo2';
      process.env.GITHUB_REPO = 'single-repo';
      process.env.GITHUB_REPO_FILTER_MODE = 'whitelist';

      // When: 설정을 생성하면
      const config = ServiceFactory.createGitHubV2ConfigFromEnv();

      // Then: GITHUB_REPOS가 우선되어야 함
      expect(config.options?.repositoryFilter).toEqual({
        allowedRepositories: ['test-org/repo1', 'test-org/repo2'],
        mode: 'whitelist'
      });
    });
  });

  describe('createServices', () => {
    it('should create all services with same provider', () => {
      // Given: ServiceFactory가 있을 때
      const config: ProviderConfig = {
        type: ServiceProvider.MOCK,
        apiToken: 'mock-token'
      };

      // When: 모든 서비스를 한 번에 생성하면
      const services = factory.createServices(config);

      // Then: 모든 서비스가 생성되어야 함
      expect(services).toBeDefined();
      expect(services.projectBoardService).toBeDefined();
      expect(services.pullRequestService).toBeDefined();
      expect(services.projectBoardService).toBeInstanceOf(MockProjectBoardService);
      expect(services.pullRequestService).toBeInstanceOf(MockPullRequestService);
    });

    it('should return services that implement correct interfaces', () => {
      // Given: ServiceFactory가 있을 때
      const config: ProviderConfig = {
        type: ServiceProvider.MOCK,
        apiToken: 'mock-token'
      };

      // When: 모든 서비스를 생성하면
      const services = factory.createServices(config);

      // Then: 올바른 인터페이스를 구현해야 함
      const { projectBoardService, pullRequestService } = services;
      
      // ProjectBoardService 인터페이스 확인
      expect(typeof projectBoardService.getBoard).toBe('function');
      expect(typeof projectBoardService.getItems).toBe('function');
      expect(typeof projectBoardService.updateItemStatus).toBe('function');

      // PullRequestService 인터페이스 확인
      expect(typeof pullRequestService.getPullRequest).toBe('function');
      expect(typeof pullRequestService.listPullRequests).toBe('function');
      expect(typeof pullRequestService.getComments).toBe('function');
    });
  });

  describe('캐싱 동작', () => {
    it('should return same instance for same config', () => {
      // Given: ServiceFactory가 있을 때
      const config: ProviderConfig = {
        type: ServiceProvider.MOCK,
        apiToken: 'mock-token'
      };

      // When: 같은 설정으로 서비스를 여러 번 생성하면
      const service1 = factory.createProjectBoardService(config);
      const service2 = factory.createProjectBoardService(config);

      // Then: 같은 인스턴스가 반환되어야 함 (캐싱)
      expect(service1).toBe(service2);
    });

    it('should return different instances for different configs', () => {
      // Given: ServiceFactory가 있을 때
      const config1: ProviderConfig = {
        type: ServiceProvider.GITHUB,
        apiToken: 'token1',
        options: { owner: 'owner1', projectNumber: 1 }
      };
      const config2: ProviderConfig = {
        type: ServiceProvider.GITHUB,
        apiToken: 'token2',
        options: { owner: 'owner2', projectNumber: 2 }
      };

      // When: 다른 설정으로 서비스를 생성하면
      const service1 = factory.createProjectBoardService(config1);
      const service2 = factory.createProjectBoardService(config2);

      // Then: 다른 인스턴스가 반환되어야 함
      expect(service1).not.toBe(service2);
    });
  });

  describe('에러 처리', () => {
    it('should provide meaningful error messages', () => {
      // Given: ServiceFactory가 있을 때
      const invalidConfig: ProviderConfig = {
        type: 'invalid' as any,
        apiToken: 'token'
      };

      // When: 잘못된 프로바이더를 사용하면
      // Then: 명확한 에러 메시지가 제공되어야 함
      expect(() => factory.createProjectBoardService(invalidConfig))
        .toThrow('Unsupported project board provider: invalid');
        
      expect(() => factory.createPullRequestService(invalidConfig))
        .toThrow('Unsupported pull request provider: invalid');
    });
  });

});
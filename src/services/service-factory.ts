import { ProjectBoardService, PullRequestService, ServiceProvider, ProviderConfig } from '@/types';
import { MockProjectBoardService } from './mock-project-board';
import { MockPullRequestService } from './mock-pull-request';
import { GitHubProjectBoardV2Service } from './project-board/github/github-project-board-v2.service';
import { GitHubPullRequestService } from './pull-request/github/github-pull-request.service';
import { ProjectV2Config } from './project-board/github/graphql-types';
import { Logger } from './logger';

export interface ServiceBundle {
  readonly projectBoardService: ProjectBoardService;
  readonly pullRequestService: PullRequestService;
}

export class ServiceFactory {
  private projectBoardServices: Map<string, ProjectBoardService> = new Map();
  private pullRequestServices: Map<string, PullRequestService> = new Map();
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger || Logger.createConsoleLogger();
  }

  createProjectBoardService(config: ProviderConfig): ProjectBoardService {
    // 설정별 캐시 키 생성
    const cacheKey = `${config.type}_${JSON.stringify(config)}`;
    const cached = this.projectBoardServices.get(cacheKey);
    if (cached) {
      return cached;
    }

    let service: ProjectBoardService;

    switch (config.type) {
      case ServiceProvider.MOCK:
        service = new MockProjectBoardService();
        break;
      case ServiceProvider.GITHUB:
        service = this.createGitHubProjectBoardService(config);
        break;
      default:
        throw new Error(`Unsupported project board provider: ${config.type}`);
    }

    this.projectBoardServices.set(cacheKey, service);
    return service;
  }

  private createGitHubProjectBoardService(config: ProviderConfig): ProjectBoardService {
    if (!config.apiToken) {
      throw new Error('GitHub API token is required');
    }

    // Projects v2 (GraphQL) 서비스만 지원
    return this.createGitHubProjectBoardV2Service(config);
  }


  private createGitHubProjectBoardV2Service(config: ProviderConfig): GitHubProjectBoardV2Service {
    const options = config.options || {};
    const projectV2Config: ProjectV2Config = {
      token: config.apiToken,
      owner: options.owner as string || '',
      projectNumber: options.projectNumber as number
    };

    // 레포지토리 필터링 설정 추가
    if (options.repositoryFilter) {
      projectV2Config.repositoryFilter = options.repositoryFilter as any;
    }

    if (!projectV2Config.owner) {
      throw new Error('GitHub owner is required for Projects v2');
    }

    if (!projectV2Config.projectNumber) {
      throw new Error('Project number is required for Projects v2');
    }

    return new GitHubProjectBoardV2Service(projectV2Config, this.logger);
  }

  createPullRequestService(config: ProviderConfig): PullRequestService {
    // 설정별 캐시 키 생성
    const cacheKey = `${config.type}_${JSON.stringify(config)}`;
    const cached = this.pullRequestServices.get(cacheKey);
    if (cached) {
      return cached;
    }

    let service: PullRequestService;

    switch (config.type) {
      case ServiceProvider.MOCK:
        service = new MockPullRequestService();
        break;
      case ServiceProvider.GITHUB:
        if (!config.apiToken) {
          throw new Error('GitHub API token is required for GitHub PullRequestService');
        }
        service = new GitHubPullRequestService(
          {
            token: config.apiToken,
            baseUrl: config.options?.baseUrl as string
          },
          this.logger
        );
        break;
      default:
        throw new Error(`Unsupported pull request provider: ${config.type}`);
    }

    this.pullRequestServices.set(cacheKey, service);
    return service;
  }

  createServices(config: ProviderConfig): ServiceBundle {
    return {
      projectBoardService: this.createProjectBoardService(config),
      pullRequestService: this.createPullRequestService(config)
    };
  }


  // 편의 메소드: GitHub Projects v2 설정 생성
  static createGitHubV2Config(options: {
    owner: string;
    projectNumber: number;
    repositoryFilter?: {
      allowedRepositories?: string[];
      mode: 'whitelist' | 'blacklist';
    };
    token?: string;
  }): ProviderConfig {
    const token = options.token || process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GitHub token is required. Set GITHUB_TOKEN environment variable or provide token in options.');
    }

    return {
      type: ServiceProvider.GITHUB,
      apiToken: token,
      options: {
        owner: options.owner,
        projectNumber: options.projectNumber,
        repositoryFilter: options.repositoryFilter,
        apiVersion: 'v2'
      }
    };
  }

  // 편의 메소드: 환경변수에서 GitHub Projects v2 설정 생성
  static createGitHubV2ConfigFromEnv(): ProviderConfig {
    const owner = process.env.GITHUB_OWNER;
    const projectNumber = process.env.GITHUB_PROJECT_NUMBER;
    const token = process.env.GITHUB_TOKEN;
    const allowedRepos = process.env.GITHUB_ALLOWED_REPOSITORIES;
    const filterMode = process.env.GITHUB_FILTER_MODE as 'whitelist' | 'blacklist' | undefined;

    if (!owner) {
      throw new Error('GITHUB_OWNER environment variable is required');
    }
    if (!projectNumber) {
      throw new Error('GITHUB_PROJECT_NUMBER environment variable is required');
    }
    if (!token) {
      throw new Error('GITHUB_TOKEN environment variable is required');
    }

    const projectNum = parseInt(projectNumber, 10);
    if (isNaN(projectNum)) {
      throw new Error('GITHUB_PROJECT_NUMBER must be a valid number');
    }

    // 레포지토리 필터 설정
    let repositoryFilter: { allowedRepositories?: string[]; mode: 'whitelist' | 'blacklist' } | undefined;
    
    if (allowedRepos) {
      // 쉼표나 세미콜론으로 구분된 레포지토리 목록 파싱
      const repositories = allowedRepos
        .split(/[,;]/)
        .map(repo => repo.trim())
        .filter(repo => repo.length > 0);

      if (repositories.length > 0) {
        repositoryFilter = {
          allowedRepositories: repositories,
          mode: filterMode || 'whitelist'
        };
      }
    }

    return {
      type: ServiceProvider.GITHUB,
      apiToken: token,
      options: {
        owner,
        projectNumber: projectNum,
        repositoryFilter,
        apiVersion: 'v2'
      }
    };
  }
}
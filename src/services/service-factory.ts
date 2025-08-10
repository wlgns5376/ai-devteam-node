import { ProjectBoardService, PullRequestService, ServiceProvider, ProviderConfig } from '@/types';
import { GitServiceInterface, RepositoryManagerInterface } from '@/types/manager.types';
import { Logger } from './logger';
import { GitService } from './git/git.service';
import { GitLockService } from './git/git-lock.service';
import { RepositoryManager } from './manager/repository-manager';
import { StateManager } from './state-manager';
import { ServiceFactoryRegistry } from './factory';
import { ConfigurationService } from './configuration';

export interface ServiceBundle {
  readonly projectBoardService: ProjectBoardService;
  readonly pullRequestService: PullRequestService;
}

export class ServiceFactory {
  private projectBoardServices: Map<string, ProjectBoardService> = new Map();
  private pullRequestServices: Map<string, PullRequestService> = new Map();
  private gitService: GitServiceInterface | null = null;
  private gitLockService: GitLockService | null = null;
  private repositoryManager: RepositoryManagerInterface | null = null;
  private logger: Logger;
  private factoryRegistry: ServiceFactoryRegistry;

  constructor(logger?: Logger) {
    this.logger = logger || Logger.createConsoleLogger();
    this.factoryRegistry = new ServiceFactoryRegistry(this.logger);
  }

  createProjectBoardService(config: ProviderConfig): ProjectBoardService {
    // 설정별 캐시 키 생성
    const cacheKey = `${config.type}_${JSON.stringify(config)}`;
    const cached = this.projectBoardServices.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // 새로운 Factory Registry를 사용하여 서비스 생성
      const factory = this.factoryRegistry.getFactory(config);
      const service = factory.createProjectBoardService(config);

      this.projectBoardServices.set(cacheKey, service);
      return service;
    } catch (error) {
      // Registry에서 "Unsupported project board provider" 에러인 경우에만 그대로 던짐
      // 나머지 구체적인 에러들(API token required, owner required 등)은 그대로 전달
      if (error instanceof Error && error.message.startsWith('Unsupported project board provider')) {
        throw error;
      }
      // 다른 모든 에러는 그대로 전달 (구체적인 에러 메시지 유지)
      throw error;
    }
  }


  createPullRequestService(config: ProviderConfig): PullRequestService {
    // 설정별 캐시 키 생성
    const cacheKey = `${config.type}_${JSON.stringify(config)}`;
    const cached = this.pullRequestServices.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // 새로운 Factory Registry를 사용하여 서비스 생성
      const factory = this.factoryRegistry.getFactory(config);
      const service = factory.createPullRequestService(config);

      this.pullRequestServices.set(cacheKey, service);
      return service;
    } catch (error) {
      // Registry에서 "Unsupported project board provider" 에러인 경우 pull request 에러로 변환
      if (error instanceof Error && error.message.startsWith('Unsupported project board provider')) {
        throw new Error(`Unsupported pull request provider: ${config.type}`);
      }
      // 다른 모든 에러는 그대로 전달 (구체적인 에러 메시지 유지)
      throw error;
    }
  }

  createServices(config: ProviderConfig): ServiceBundle {
    return {
      projectBoardService: this.createProjectBoardService(config),
      pullRequestService: this.createPullRequestService(config)
    };
  }


  createGitService(gitOperationTimeoutMs: number = 60000): GitServiceInterface {
    if (!this.gitService) {
      if (!this.gitLockService) {
        this.gitLockService = new GitLockService({ 
          logger: this.logger,
          lockTimeoutMs: 5 * 60 * 1000 // 5분
        });
      }

      this.gitService = new GitService({
        logger: this.logger,
        gitOperationTimeoutMs,
        gitLockService: this.gitLockService
      });
    }
    return this.gitService;
  }

  createGitLockService(lockTimeoutMs: number = 5 * 60 * 1000): GitLockService {
    if (!this.gitLockService) {
      this.gitLockService = new GitLockService({
        logger: this.logger,
        lockTimeoutMs
      });
    }
    return this.gitLockService;
  }

  createRepositoryManager(
    config: {
      workspaceBasePath: string;
      repositoryCacheTimeoutMs: number;
      gitOperationTimeoutMs: number;
      minWorkers: number;
      maxWorkers: number;
      workerRecoveryTimeoutMs: number;
    },
    stateManager: StateManager
  ): RepositoryManagerInterface {
    if (!this.repositoryManager) {
      const gitService = this.createGitService(config.gitOperationTimeoutMs);
      
      this.repositoryManager = new RepositoryManager(
        config,
        {
          logger: this.logger,
          stateManager,
          gitService
        }
      );
    }
    return this.repositoryManager;
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
    return ConfigurationService.createGitHubV2Config(options);
  }

  // 편의 메소드: 환경변수에서 GitHub Projects v2 설정 생성
  static createGitHubV2ConfigFromEnv(): ProviderConfig {
    return ConfigurationService.createGitHubV2ConfigFromEnv();
  }
}
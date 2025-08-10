import { ProjectBoardService, PullRequestService, ProviderConfig, ServiceProvider } from '@/types';
import { GitHubProjectBoardV2Service } from '../project-board/github/github-project-board-v2.service';
import { GitHubPullRequestService } from '../pull-request/github/github-pull-request.service';
import { ProjectV2Config } from '../project-board/github/graphql-types';
import { AbstractServiceFactory } from './abstract-service.factory';

/**
 * GitHub 서비스 전용 Factory
 * GitHub Projects v2와 GitHub Pull Request 서비스를 생성
 */
export class GitHubServiceFactory extends AbstractServiceFactory {
  /**
   * GitHub ProjectBoard 서비스 생성
   */
  createProjectBoardService(config: ProviderConfig): ProjectBoardService {
    if (!this.canHandle(config)) {
      throw new Error(`GitHub factory cannot handle provider type: ${config.type}`);
    }

    if (!config.apiToken) {
      throw new Error('GitHub API token is required');
    }

    // Projects v2 (GraphQL) 서비스만 지원
    return this.createGitHubProjectBoardV2Service(config);
  }

  /**
   * GitHub PullRequest 서비스 생성
   */
  createPullRequestService(config: ProviderConfig): PullRequestService {
    if (!this.canHandle(config)) {
      throw new Error(`GitHub factory cannot handle provider type: ${config.type}`);
    }

    if (!config.apiToken) {
      throw new Error('GitHub API token is required for GitHub PullRequestService');
    }

    return new GitHubPullRequestService(
      {
        token: config.apiToken,
        baseUrl: config.options?.baseUrl as string
      },
      this.logger
    );
  }

  /**
   * 지원하는 서비스 제공자 타입 반환
   */
  getSupportedProviderType(): string {
    return ServiceProvider.GITHUB;
  }

  /**
   * GitHub Projects v2 서비스 생성
   */
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
}
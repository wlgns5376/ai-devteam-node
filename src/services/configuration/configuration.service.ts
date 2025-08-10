import { ProviderConfig, ServiceProvider } from '@/types';

/**
 * 환경변수 기반 설정 처리를 담당하는 서비스
 * ServiceFactory에서 환경변수 처리 로직을 분리
 */
export class ConfigurationService {
  /**
   * GitHub Projects v2 설정을 환경변수에서 생성
   */
  static createGitHubV2ConfigFromEnv(): ProviderConfig {
    const owner = process.env.GITHUB_OWNER;
    const projectNumber = process.env.GITHUB_PROJECT_NUMBER;
    const token = process.env.GITHUB_TOKEN;
    const githubRepos = process.env.GITHUB_REPOS;
    const githubRepo = process.env.GITHUB_REPO;
    const filterMode = process.env.GITHUB_REPO_FILTER_MODE as 'whitelist' | 'blacklist' | undefined;

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
    
    // GITHUB_REPOS 환경변수 우선 (새로운 방식)
    if (githubRepos) {
      const repositories = githubRepos
        .split(',')
        .map(repo => repo.trim())
        .filter(repo => repo.length > 0);

      if (repositories.length > 0) {
        repositoryFilter = {
          allowedRepositories: repositories,
          mode: filterMode || 'whitelist'
        };
      }
    }
    // GITHUB_REPO 환경변수 사용 (기존 방식)
    else if (githubRepo) {
      repositoryFilter = {
        allowedRepositories: [`${owner}/${githubRepo}`],
        mode: 'whitelist'
      };
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

  /**
   * GitHub Projects v2 설정을 옵션에서 생성
   */
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

  /**
   * Mock 설정 생성
   */
  static createMockConfig(): ProviderConfig {
    return {
      type: ServiceProvider.MOCK,
      apiToken: 'mock-token'
    };
  }
}
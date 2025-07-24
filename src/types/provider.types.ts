import { ProjectBoardService } from './project-board.types';
import { PullRequestService } from './pull-request.types';
import { RepositoryService } from './repository.types';

export { ProjectBoardService } from './project-board.types';
export { PullRequestService } from './pull-request.types';
export { RepositoryService } from './repository.types';

export enum ServiceProvider {
  MOCK = 'mock',
  GITHUB = 'github',
  JIRA = 'jira',
  NOTION = 'notion',
  GITLAB = 'gitlab'
}

export interface ProviderConfig {
  readonly type: ServiceProvider;
  readonly apiToken: string;
  readonly baseUrl?: string;
  readonly options?: Record<string, unknown>;
}

export interface ServiceFactory {
  createProjectBoardService(config: ProviderConfig): ProjectBoardService;
  createPullRequestService(config: ProviderConfig): PullRequestService;
  createRepositoryService(config: ProviderConfig): RepositoryService;
}
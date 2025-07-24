import { ProjectBoardService, PullRequestService, ServiceProvider } from '@/types';
import { MockProjectBoardService } from './mock-project-board';
import { MockPullRequestService } from './mock-pull-request';

export interface ServiceBundle {
  readonly projectBoardService: ProjectBoardService;
  readonly pullRequestService: PullRequestService;
}

export class ServiceFactory {
  private projectBoardServices: Map<ServiceProvider, ProjectBoardService> = new Map();
  private pullRequestServices: Map<ServiceProvider, PullRequestService> = new Map();

  createProjectBoardService(provider: ServiceProvider): ProjectBoardService {
    // 싱글톤 패턴 적용
    const cached = this.projectBoardServices.get(provider);
    if (cached) {
      return cached;
    }

    let service: ProjectBoardService;

    switch (provider) {
      case ServiceProvider.MOCK:
        service = new MockProjectBoardService();
        break;
      default:
        throw new Error(`Unsupported project board provider: ${provider}`);
    }

    this.projectBoardServices.set(provider, service);
    return service;
  }

  createPullRequestService(provider: ServiceProvider): PullRequestService {
    // 싱글톤 패턴 적용
    const cached = this.pullRequestServices.get(provider);
    if (cached) {
      return cached;
    }

    let service: PullRequestService;

    switch (provider) {
      case ServiceProvider.MOCK:
        service = new MockPullRequestService();
        break;
      default:
        throw new Error(`Unsupported pull request provider: ${provider}`);
    }

    this.pullRequestServices.set(provider, service);
    return service;
  }

  createServices(provider: ServiceProvider): ServiceBundle {
    return {
      projectBoardService: this.createProjectBoardService(provider),
      pullRequestService: this.createPullRequestService(provider)
    };
  }
}
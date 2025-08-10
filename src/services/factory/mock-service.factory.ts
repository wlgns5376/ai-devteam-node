import { ProjectBoardService, PullRequestService, ProviderConfig, ServiceProvider } from '@/types';
import { MockProjectBoardService } from '../mock-project-board';
import { MockPullRequestService } from '../mock-pull-request';
import { AbstractServiceFactory } from './abstract-service.factory';

/**
 * Mock 서비스 전용 Factory
 * 테스트 및 개발용 Mock 서비스를 생성
 */
export class MockServiceFactory extends AbstractServiceFactory {
  /**
   * Mock ProjectBoard 서비스 생성
   */
  createProjectBoardService(config: ProviderConfig): ProjectBoardService {
    if (!this.canHandle(config)) {
      throw new Error(`Mock factory cannot handle provider type: ${config.type}`);
    }

    return new MockProjectBoardService();
  }

  /**
   * Mock PullRequest 서비스 생성
   */
  createPullRequestService(config: ProviderConfig): PullRequestService {
    if (!this.canHandle(config)) {
      throw new Error(`Mock factory cannot handle provider type: ${config.type}`);
    }

    return new MockPullRequestService();
  }

  /**
   * 지원하는 서비스 제공자 타입 반환
   */
  getSupportedProviderType(): string {
    return ServiceProvider.MOCK;
  }
}
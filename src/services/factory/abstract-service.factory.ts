import { ProjectBoardService, PullRequestService, ProviderConfig } from '@/types';
import { Logger } from '../logger';

/**
 * 서비스 Factory의 추상 인터페이스
 * 각 서비스 제공자별로 구현체를 만들어 확장성과 유지보수성 향상
 */
export abstract class AbstractServiceFactory {
  protected logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger || Logger.createConsoleLogger();
  }

  /**
   * ProjectBoard 서비스를 생성합니다
   */
  abstract createProjectBoardService(config: ProviderConfig): ProjectBoardService;

  /**
   * PullRequest 서비스를 생성합니다
   */
  abstract createPullRequestService(config: ProviderConfig): PullRequestService;

  /**
   * 이 Factory가 지원하는 서비스 제공자 타입을 반환합니다
   */
  abstract getSupportedProviderType(): string;

  /**
   * 주어진 설정이 이 Factory에서 처리 가능한지 확인합니다
   */
  canHandle(config: ProviderConfig): boolean {
    return config.type === this.getSupportedProviderType();
  }
}
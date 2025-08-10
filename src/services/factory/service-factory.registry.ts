import { ProviderConfig } from '@/types';
import { AbstractServiceFactory } from './abstract-service.factory';
import { GitHubServiceFactory } from './github-service.factory';
import { MockServiceFactory } from './mock-service.factory';
import { Logger } from '../logger';

/**
 * 서비스 Factory들을 관리하고 적절한 Factory를 선택하는 레지스트리
 * 새로운 서비스 제공자 추가 시 여기에만 등록하면 됨 (Open-Closed Principle)
 */
export class ServiceFactoryRegistry {
  private factories: Map<string, AbstractServiceFactory> = new Map();

  constructor(logger?: Logger) {
    // 기본 Factory들 등록
    this.registerFactory(new GitHubServiceFactory(logger));
    this.registerFactory(new MockServiceFactory(logger));
  }

  /**
   * Factory를 레지스트리에 등록
   */
  registerFactory(factory: AbstractServiceFactory): void {
    const providerType = factory.getSupportedProviderType();
    this.factories.set(providerType, factory);
  }

  /**
   * 설정에 맞는 적절한 Factory를 찾아서 반환
   */
  getFactory(config: ProviderConfig): AbstractServiceFactory {
    const factory = this.factories.get(config.type);
    
    if (!factory) {
      // 기존 테스트와 호환성을 위해 기존 에러 메시지 형식 유지
      throw new Error(`Unsupported project board provider: ${config.type}`);
    }

    if (!factory.canHandle(config)) {
      throw new Error(
        `Factory for ${config.type} cannot handle the provided configuration`
      );
    }

    return factory;
  }

  /**
   * 등록된 모든 Factory들을 반환
   */
  getAllFactories(): AbstractServiceFactory[] {
    return Array.from(this.factories.values());
  }

  /**
   * 지원되는 서비스 제공자 타입들을 반환
   */
  getSupportedProviderTypes(): string[] {
    return Array.from(this.factories.keys());
  }
}
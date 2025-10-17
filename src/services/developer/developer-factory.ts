import {
  DeveloperInterface,
  DeveloperType,
  DeveloperConfig,
  DeveloperDependencies
} from '@/types/developer.types';
import { MockDeveloper } from './mock-developer';
import { ClaudeDeveloper } from './claude-developer';
import { ClaudeDeveloperSDK } from './claude-developer-sdk';

export class DeveloperFactory {
  static create(
    type: DeveloperType,
    config: DeveloperConfig,
    dependencies: DeveloperDependencies
  ): DeveloperInterface {
    switch (type) {
      case 'mock':
        return new MockDeveloper(config, dependencies);

      case 'claude':
        // SDK 모드 또는 CLI 모드 선택
        if (config.useSDK) {
          dependencies.logger.info('Creating Claude Developer with SDK mode');
          return new ClaudeDeveloperSDK(config, dependencies);
        } else {
          dependencies.logger.info('Creating Claude Developer with CLI mode');
          return new ClaudeDeveloper(config, dependencies);
        }

      case 'gemini':
        // Gemini 설정 검증
        if (!config.gemini?.apiKey) {
          throw new Error('Gemini API key is required');
        }
        // GeminiDeveloper 구현 전까지 Mock Developer 사용
        // 향후 GeminiDeveloper 클래스 구현 필요
        return new MockDeveloper(config, dependencies);

      default:
        throw new Error(`Unsupported developer type: ${type}`);
    }
  }
}
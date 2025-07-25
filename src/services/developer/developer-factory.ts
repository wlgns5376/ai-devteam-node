import {
  DeveloperInterface,
  DeveloperType,
  DeveloperConfig,
  DeveloperDependencies
} from '@/types/developer.types';
import { MockDeveloper } from './mock-developer';

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
        // Claude 설정 검증
        if (!config.claude?.apiKey) {
          throw new Error('Claude API key is required');
        }
        // TODO: ClaudeDeveloper 구현 후 실제 인스턴스 반환
        // 임시로 Mock Developer 반환
        return new MockDeveloper(config, dependencies);
      
      case 'gemini':
        // Gemini 설정 검증
        if (!config.gemini?.apiKey) {
          throw new Error('Gemini API key is required');
        }
        // TODO: GeminiDeveloper 구현 후 실제 인스턴스 반환
        // 임시로 Mock Developer 반환
        return new MockDeveloper(config, dependencies);
      
      default:
        throw new Error(`Unsupported developer type: ${type}`);
    }
  }
}
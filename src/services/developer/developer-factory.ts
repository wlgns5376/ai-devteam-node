import {
  DeveloperInterface,
  DeveloperType,
  DeveloperConfig,
  DeveloperDependencies
} from '@/types/developer.types';
import { MockDeveloper } from './mock-developer';
import { ClaudeDeveloper } from './claude-developer';

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
        // Claude는 API 키 또는 로그인 방식 모두 지원
        return new ClaudeDeveloper(config, dependencies);
      
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
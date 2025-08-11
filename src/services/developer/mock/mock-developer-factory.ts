import { 
  DeveloperInterface, 
  DeveloperType, 
  DeveloperConfig, 
  DeveloperDependencies 
} from '@/types/developer.types';
import { MockDeveloper } from '../mock-developer';

export class MockDeveloperFactory {
  constructor(private readonly mockDeveloper: DeveloperInterface) {}

  static create(
    type: DeveloperType,
    config: DeveloperConfig,
    dependencies: DeveloperDependencies
  ): DeveloperInterface {
    // 모든 타입에 대해 MockDeveloper를 반환
    return new MockDeveloper(config, dependencies);
  }

  // 인스턴스 메서드로도 지원 (호환성)
  create(
    type: DeveloperType,
    config: DeveloperConfig,
    dependencies: DeveloperDependencies
  ): DeveloperInterface {
    // 미리 생성된 MockDeveloper 인스턴스를 반환
    return this.mockDeveloper;
  }

  async cleanup(): Promise<void> {
    await this.mockDeveloper.cleanup();
  }
}
import { DeveloperFactory } from '@/services/developer/developer-factory';
import { MockDeveloper } from '@/services/developer/mock-developer';
import { Logger } from '@/services/logger';
import { 
  DeveloperConfig, 
  DeveloperType,
  DeveloperInterface
} from '@/types/developer.types';

describe('DeveloperFactory', () => {
  let mockLogger: jest.Mocked<Logger>;
  let config: DeveloperConfig;

  beforeEach(() => {
    // Given: Mock 의존성 설정
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    config = {
      timeoutMs: 30000,
      maxRetries: 3,
      retryDelayMs: 1000
    };
  });

  describe('Developer 생성', () => {
    it('Mock Developer를 생성해야 한다', () => {
      // Given: Mock 타입과 설정
      const type: DeveloperType = 'mock';
      const mockConfig = {
        ...config,
        mock: {
          responseDelay: 100
        }
      };

      // When: Developer 생성
      const developer = DeveloperFactory.create(type, mockConfig, { logger: mockLogger });

      // Then: MockDeveloper 인스턴스 확인
      expect(developer).toBeInstanceOf(MockDeveloper);
      expect(developer.type).toBe('mock');
    });

    it('Claude Developer를 생성해야 한다 (현재는 Mock 반환)', () => {
      // Given: Claude 타입과 설정
      const type: DeveloperType = 'claude';
      const claudeConfig = {
        ...config,
        claude: {
          apiKey: 'test-api-key',
          model: 'claude-3'
        }
      };

      // When: Developer 생성
      const developer = DeveloperFactory.create(type, claudeConfig, { logger: mockLogger });

      // Then: 현재는 MockDeveloper 인스턴스 반환 (TODO: ClaudeDeveloper 구현 후 수정)
      expect(developer).toBeDefined();
      expect(developer).toBeInstanceOf(MockDeveloper);
      expect(developer.type).toBe('mock'); // 임시로 mock 타입 확인
    });

    it('Gemini Developer를 생성해야 한다 (현재는 Mock 반환)', () => {
      // Given: Gemini 타입과 설정
      const type: DeveloperType = 'gemini';
      const geminiConfig = {
        ...config,
        gemini: {
          apiKey: 'test-api-key',
          model: 'gemini-pro'
        }
      };

      // When: Developer 생성
      const developer = DeveloperFactory.create(type, geminiConfig, { logger: mockLogger });

      // Then: 현재는 MockDeveloper 인스턴스 반환 (TODO: GeminiDeveloper 구현 후 수정)
      expect(developer).toBeDefined();
      expect(developer).toBeInstanceOf(MockDeveloper);
      expect(developer.type).toBe('mock'); // 임시로 mock 타입 확인
    });

    it('지원하지 않는 타입에 대해 에러를 발생시켜야 한다', () => {
      // Given: 지원하지 않는 타입
      const invalidType = 'invalid' as DeveloperType;

      // When & Then: 에러 발생
      expect(() => {
        DeveloperFactory.create(invalidType, config, { logger: mockLogger });
      }).toThrow('Unsupported developer type: invalid');
    });
  });

  describe('설정 검증', () => {
    it('필수 설정이 없으면 에러를 발생시켜야 한다', () => {
      // Given: Claude 타입이지만 API 키가 없는 설정
      const type: DeveloperType = 'claude';
      const invalidConfig = {
        ...config,
        claude: {
          model: 'claude-3'
          // apiKey 누락
        }
      };

      // When & Then: 에러 발생
      expect(() => {
        DeveloperFactory.create(type, invalidConfig as DeveloperConfig, { logger: mockLogger });
      }).toThrow('Claude API key is required');
    });

    it('Mock Developer는 추가 설정 없이도 생성되어야 한다', () => {
      // Given: Mock 타입과 최소 설정
      const type: DeveloperType = 'mock';

      // When: Developer 생성
      const developer = DeveloperFactory.create(type, config, { logger: mockLogger });

      // Then: 정상 생성
      expect(developer).toBeInstanceOf(MockDeveloper);
    });
  });

  describe('인스턴스 재사용', () => {
    it('동일한 설정으로 여러 인스턴스를 생성할 수 있어야 한다', () => {
      // Given: Mock 타입
      const type: DeveloperType = 'mock';

      // When: 여러 인스턴스 생성
      const developer1 = DeveloperFactory.create(type, config, { logger: mockLogger });
      const developer2 = DeveloperFactory.create(type, config, { logger: mockLogger });

      // Then: 서로 다른 인스턴스
      expect(developer1).not.toBe(developer2);
      expect(developer1).toBeInstanceOf(MockDeveloper);
      expect(developer2).toBeInstanceOf(MockDeveloper);
    });
  });

  describe('타입 가드', () => {
    it('생성된 Developer가 올바른 인터페이스를 구현해야 한다', async () => {
      // Given: Mock Developer 생성
      const developer = DeveloperFactory.create('mock', config, { logger: mockLogger });

      // Then: DeveloperInterface 메서드 확인
      expect(typeof developer.initialize).toBe('function');
      expect(typeof developer.executePrompt).toBe('function');
      expect(typeof developer.cleanup).toBe('function');
      expect(typeof developer.isAvailable).toBe('function');
      expect(typeof developer.setTimeout).toBe('function');
      expect(developer.type).toBeDefined();
    });
  });
});
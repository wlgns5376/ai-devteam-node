import { MockDeveloper } from '@/services/developer/mock-developer';
import { Logger } from '@/services/logger';
import { 
  DeveloperConfig, 
  DeveloperOutput, 
  MockScenario,
  DeveloperErrorCode,
  DeveloperError
} from '@/types/developer.types';

describe('MockDeveloper', () => {
  let mockDeveloper: MockDeveloper;
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
      retryDelayMs: 1000,
      mock: {
        responseDelay: 100,
        defaultScenario: MockScenario.SUCCESS_WITH_PR
      }
    };

    mockDeveloper = new MockDeveloper(config, { logger: mockLogger });
  });

  describe('초기화', () => {
    it('성공적으로 초기화되어야 한다', async () => {
      // When: 초기화
      await mockDeveloper.initialize();

      // Then: 사용 가능 상태
      const isAvailable = await mockDeveloper.isAvailable();
      expect(isAvailable).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('Mock Developer initialized');
    });

    it('타입이 mock이어야 한다', () => {
      // Then: 타입 확인
      expect(mockDeveloper.type).toBe('mock');
    });
  });

  describe('프롬프트 실행', () => {
    beforeEach(async () => {
      await mockDeveloper.initialize();
    });

    describe('성공 시나리오', () => {
      it('PR 생성과 함께 성공해야 한다', async () => {
        // Given: PR 생성 시나리오 설정
        mockDeveloper.setScenario(MockScenario.SUCCESS_WITH_PR);
        const prompt = '사용자 인증 기능을 구현해주세요';
        const workspaceDir = '/tmp/test-workspace';

        // When: 프롬프트 실행
        const output = await mockDeveloper.executePrompt(prompt, workspaceDir);

        // Then: 성공 결과 확인
        expect(output.result.success).toBe(true);
        expect(output.result.prLink).toMatch(/https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+/);
        expect(output.result.commitHash).toMatch(/^[0-9a-f]{40}$/);
        expect(output.result.error).toBeUndefined();
        
        // 실행된 명령어 확인
        expect(output.executedCommands).toHaveLength(4);
        expect(output.executedCommands[0]?.command).toBe('git checkout -b feature/user-auth');
        expect(output.executedCommands[1]?.command).toContain('git add');
        expect(output.executedCommands[2]?.command).toContain('git commit');
        expect(output.executedCommands[3]?.command).toContain('gh pr create');
        
        // 수정된 파일 확인
        expect(output.modifiedFiles).toContain('src/auth/auth.service.ts');
        expect(output.modifiedFiles).toContain('src/auth/auth.controller.ts');
        
        // 메타데이터 확인
        expect(output.metadata.developerType).toBe('mock');
        expect(output.metadata.duration).toBeGreaterThan(0);
      });

      it('코드 수정만으로 성공해야 한다', async () => {
        // Given: 코드 수정만 하는 시나리오
        mockDeveloper.setScenario(MockScenario.SUCCESS_CODE_ONLY);
        const prompt = '코드 리팩토링을 수행해주세요';
        const workspaceDir = '/tmp/test-workspace';

        // When: 프롬프트 실행
        const output = await mockDeveloper.executePrompt(prompt, workspaceDir);

        // Then: 성공하지만 PR 없음
        expect(output.result.success).toBe(true);
        expect(output.result.prLink).toBeUndefined();
        expect(output.result.commitHash).toMatch(/^[0-9a-f]{40}$/);
        expect(output.executedCommands).toHaveLength(2);
        expect(output.modifiedFiles.length).toBeGreaterThan(0);
      });

      it('PR 피드백을 반영해야 한다', async () => {
        // Given: PR 피드백 반영 시나리오
        mockDeveloper.setScenario(MockScenario.PR_FEEDBACK_APPLIED);
        const prompt = 'PR 피드백을 반영해주세요';
        const workspaceDir = '/tmp/test-workspace';

        // When: 프롬프트 실행
        const output = await mockDeveloper.executePrompt(prompt, workspaceDir);

        // Then: 성공 결과 확인
        expect(output.result.success).toBe(true);
        expect(output.result.prLink).toMatch(/https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+/);
        expect(output.result.commitHash).toMatch(/^[0-9a-f]{40}$/);
        expect(output.result.error).toBeUndefined();
        
        // 실행된 명령어 확인 (피드백 반영은 3개 명령어)
        expect(output.executedCommands).toHaveLength(3);
        expect(output.executedCommands[0]?.command).toBe('git add .');
        expect(output.executedCommands[1]?.command).toBe('git commit -m "Apply PR feedback: fix code review comments"');
        expect(output.executedCommands[2]?.command).toContain('git push origin feature/user-auth');
        
        // 수정된 파일 확인
        expect(output.modifiedFiles).toContain('src/auth/auth.service.ts');
        expect(output.modifiedFiles).toContain('src/auth/auth.controller.ts');
        
        // rawOutput에 피드백 관련 메시지 포함 확인
        expect(output.rawOutput).toContain('PR 리뷰 피드백을 반영하고 있습니다');
        expect(output.rawOutput).toContain('📝 리뷰 코멘트 분석 완료');
        expect(output.rawOutput).toContain('🔧 코드 수정 중');
        expect(output.rawOutput).toContain('✅ 피드백 반영 완료 - PR 업데이트됨');
        expect(output.rawOutput).toContain('🎉 모든 리뷰 코멘트가 반영되었습니다');
        
        // 메타데이터 확인
        expect(output.metadata.developerType).toBe('mock');
        expect(output.metadata.duration).toBeGreaterThanOrEqual(0);
      });
    });

    describe('실패 시나리오', () => {
      it('에러 시나리오에서 실패해야 한다', async () => {
        // Given: 에러 시나리오 설정
        mockDeveloper.setScenario(MockScenario.ERROR);
        const prompt = '에러를 발생시켜주세요';
        const workspaceDir = '/tmp/test-workspace';

        // When & Then: 에러 발생
        await expect(mockDeveloper.executePrompt(prompt, workspaceDir))
          .rejects
          .toThrow(DeveloperError);

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Mock Developer execution failed',
          expect.any(Object)
        );
      });

      it('타임아웃 시나리오에서 타임아웃되어야 한다', async () => {
        // Given: 타임아웃 시나리오
        mockDeveloper.setScenario(MockScenario.TIMEOUT);
        mockDeveloper.setTimeout(1000); // 1초 타임아웃
        const prompt = '오래 걸리는 작업';
        const workspaceDir = '/tmp/test-workspace';

        // When & Then: 타임아웃 에러
        await expect(mockDeveloper.executePrompt(prompt, workspaceDir))
          .rejects
          .toThrow(new DeveloperError(
            'Mock Developer timeout',
            DeveloperErrorCode.TIMEOUT,
            'mock'
          ));
      });
    });

    describe('응답 지연', () => {
      it('설정된 지연 시간만큼 대기해야 한다', async () => {
        // Given: 500ms 지연 설정
        const delayMs = 500;
        mockDeveloper = new MockDeveloper({
          ...config,
          mock: { responseDelay: delayMs }
        }, { logger: mockLogger });
        await mockDeveloper.initialize();

        // When: 프롬프트 실행
        const startTime = Date.now();
        await mockDeveloper.executePrompt('test prompt', '/tmp/workspace');
        const endTime = Date.now();

        // Then: 최소 지연 시간 확인
        expect(endTime - startTime).toBeGreaterThanOrEqual(delayMs);
      });
    });
  });

  describe('타임아웃 설정', () => {
    it('타임아웃을 설정할 수 있어야 한다', async () => {
      // Given: 초기화
      await mockDeveloper.initialize();

      // When: 타임아웃 설정
      mockDeveloper.setTimeout(5000);

      // Then: 로그 확인
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Mock Developer timeout set',
        { timeoutMs: 5000 }
      );
    });
  });

  describe('정리', () => {
    it('리소스를 정리해야 한다', async () => {
      // Given: 초기화된 상태
      await mockDeveloper.initialize();

      // When: 정리
      await mockDeveloper.cleanup();

      // Then: 사용 불가능 상태
      const isAvailable = await mockDeveloper.isAvailable();
      expect(isAvailable).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith('Mock Developer cleaned up');
    });
  });

  describe('시나리오 관리', () => {
    it('시나리오를 변경할 수 있어야 한다', async () => {
      // Given: 초기화
      await mockDeveloper.initialize();

      // When: 시나리오 변경
      mockDeveloper.setScenario(MockScenario.ERROR);

      // Then: 변경된 시나리오로 동작
      await expect(mockDeveloper.executePrompt('test', '/tmp'))
        .rejects
        .toThrow(DeveloperError);
    });

    it('프롬프트에 따라 동적으로 시나리오를 선택해야 한다', async () => {
      // Given: 초기화
      await mockDeveloper.initialize();

      // When & Then: PR 생성 요청
      const prOutput = await mockDeveloper.executePrompt(
        'PR을 생성해주세요',
        '/tmp/workspace'
      );
      expect(prOutput.result.prLink).toBeDefined();

      // When & Then: 리팩토링 요청
      const refactorOutput = await mockDeveloper.executePrompt(
        '리팩토링만 수행해주세요',
        '/tmp/workspace'
      );
      expect(refactorOutput.result.prLink).toBeUndefined();
      expect(refactorOutput.result.success).toBe(true);

      // When & Then: 피드백 반영 요청
      const feedbackOutput = await mockDeveloper.executePrompt(
        '리뷰 피드백을 반영해주세요',
        '/tmp/workspace'
      );
      expect(feedbackOutput.result.prLink).toBeDefined();
      expect(feedbackOutput.result.success).toBe(true);
      expect(feedbackOutput.rawOutput).toContain('PR 리뷰 피드백을 반영하고 있습니다');
    });
  });
});
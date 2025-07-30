import { ClaudeDeveloper } from '@/services/developer/claude-developer';
import { Logger } from '@/services/logger';
import { 
  DeveloperConfig, 
  DeveloperOutput, 
  DeveloperErrorCode,
  DeveloperError
} from '@/types/developer.types';
import { exec } from 'child_process';

// child_process mock
jest.mock('child_process');
const mockedExec = jest.mocked(exec);

describe('ClaudeDeveloper', () => {
  let claudeDeveloper: ClaudeDeveloper;
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
      claude: {
        apiKey: 'test-api-key',
        model: 'claude-3-sonnet-20240229',
        maxTokens: 4000,
        temperature: 0.7
      }
    };

    claudeDeveloper = new ClaudeDeveloper(config, { logger: mockLogger });
    
    // Mock 기본 설정
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('초기화', () => {
    it('성공적으로 초기화되어야 한다', async () => {
      // Given: Claude CLI 설치 확인 성공
      mockedExec.mockImplementationOnce((command: string, options: any, callback: any) => {
        process.nextTick(() => callback(null, { stdout: 'claude version 1.0.0', stderr: '' }));
        return {} as any;
      });

      // When: 초기화
      await claudeDeveloper.initialize();

      // Then: 사용 가능 상태
      const isAvailable = await claudeDeveloper.isAvailable();
      expect(isAvailable).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('Claude Developer initialized with API key');
    });

    it('타입이 claude여야 한다', () => {
      // Then: 타입 확인
      expect(claudeDeveloper.type).toBe('claude');
    });

    it('Claude CLI가 설치되지 않았으면 실패해야 한다', async () => {
      // Given: Claude CLI 명령어 실패
      mockedExec.mockImplementationOnce((command: string, options: any, callback: any) => {
        process.nextTick(() => callback(new Error('command not found: claude'), null));
        return {} as any;
      });
      
      // 두 번째 시도도 실패
      mockedExec.mockImplementationOnce((command: string, options: any, callback: any) => {
        process.nextTick(() => callback(new Error('command not found: claude'), null));
        return {} as any;
      });

      // When & Then: 초기화 실패
      await expect(claudeDeveloper.initialize()).rejects.toThrow(
        new DeveloperError(
          'Claude CLI is not installed or not accessible',
          DeveloperErrorCode.INITIALIZATION_FAILED,
          'claude'
        )
      );
    }, 10000);

    it('API 키가 없어도 시스템 인증으로 초기화될 수 있어야 한다', async () => {
      // Given: API 키 없는 설정 (claudeCodePath 포함)
      const configWithoutApiKey: DeveloperConfig = {
        timeoutMs: 30000,
        maxRetries: 3,
        retryDelayMs: 1000,
        claudeCodePath: '/fake/claude/path'  // 테스트용 가짜 경로
      };
      
      // Mock으로 CLI 확인 성공 (claude --help)
      mockedExec.mockImplementationOnce((command: string, options: any, callback: any) => {
        process.nextTick(() => callback(null, { stdout: 'claude help output', stderr: '' }));
        return {} as any;
      });
      
      const claudeDeveloper = new ClaudeDeveloper(configWithoutApiKey, { logger: mockLogger });
      
      // When: 초기화
      await claudeDeveloper.initialize();
      
      // Then: 성공적으로 초기화되고 시스템 인증 메시지 로그
      const isAvailable = await claudeDeveloper.isAvailable();
      expect(isAvailable).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('Claude Developer initialized (will use system authentication)');
    });
  });

  describe('프롬프트 실행', () => {
    beforeEach(async () => {
      // Claude CLI 설치 확인 Mock
      mockedExec.mockImplementationOnce((command: string, options: any, callback: any) => {
        process.nextTick(() => callback(null, { stdout: 'claude version 1.0.0', stderr: '' }));
        return {} as any;
      });
      
      await claudeDeveloper.initialize();
      jest.clearAllMocks();
    });

    describe('성공 시나리오', () => {
      it('PR 생성과 함께 성공해야 한다', async () => {
        // Given: Claude CLI 성공 응답
        const mockOutput = `작업을 시작합니다...

$ git checkout -b feature/user-auth
Switched to a new branch 'feature/user-auth'

$ git add .

$ git commit -m "Add user authentication"
[feature/user-auth a1b2c3d] Add user authentication
 3 files changed, 150 insertions(+)

$ gh pr create --title "Add user authentication" --body "Implements JWT-based authentication"
https://github.com/test/repo/pull/123

PR이 생성되었습니다: https://github.com/test/repo/pull/123

작업을 완료했습니다!`;

        mockedExec.mockImplementationOnce((command: string, options: any, callback: any) => {
          setTimeout(() => callback(null, { stdout: mockOutput, stderr: '' }), 10);
          return {} as any;
        });

        const prompt = '사용자 인증 기능을 구현해주세요';
        const workspaceDir = '/tmp/test-workspace';

        // When: 프롬프트 실행
        const output = await claudeDeveloper.executePrompt(prompt, workspaceDir);

        // Then: 성공 결과 확인
        expect(output.result.success).toBe(true);
        expect(output.result.prLink).toBe('https://github.com/test/repo/pull/123');
        expect(output.result.error).toBeUndefined();
        
        // 실행된 명령어 확인
        expect(output.executedCommands).toHaveLength(4);
        expect(output.executedCommands[0]?.command).toBe('git checkout -b feature/user-auth');
        expect(output.executedCommands[1]?.command).toBe('git add .');
        expect(output.executedCommands[2]?.command).toBe('git commit -m "Add user authentication"');
        expect(output.executedCommands[3]?.command).toBe('gh pr create --title "Add user authentication" --body "Implements JWT-based authentication"');
        
        // 메타데이터 확인
        expect(output.metadata.developerType).toBe('claude');
        expect(output.metadata.duration).toBeGreaterThan(0);
        expect(output.rawOutput).toBe(mockOutput);
        
        // Claude CLI 명령어 실행 확인 (파일을 통한 파이프 방식)
        expect(mockedExec).toHaveBeenCalledWith(
          expect.stringMatching(/^cat ".*claude-prompt-.*\.txt" \| "claude" --dangerously-skip-permissions -p$/),
          expect.objectContaining({
            cwd: workspaceDir,
            timeout: 30000,
            env: expect.objectContaining({
              ANTHROPIC_API_KEY: 'test-api-key'
            })
          }),
          expect.any(Function)
        );
      });

      it('코드 수정만으로 성공해야 한다', async () => {
        // Given: PR 없는 성공 응답
        const mockOutput = `작업을 시작합니다...

$ git add .

$ git commit -m "Refactor code structure"
[main b4c5d6e] Refactor code structure
 2 files changed, 50 insertions(+), 30 deletions(-)

작업을 완료했습니다!`;

        mockedExec.mockImplementationOnce((command: string, options: any, callback: any) => {
          process.nextTick(() => callback(null, { stdout: mockOutput, stderr: '' }));
          return {} as any;
        });

        const prompt = '코드 리팩토링을 수행해주세요';
        const workspaceDir = '/tmp/test-workspace';

        // When: 프롬프트 실행
        const output = await claudeDeveloper.executePrompt(prompt, workspaceDir);

        // Then: 성공하지만 PR 없음
        expect(output.result.success).toBe(true);
        expect(output.result.prLink).toBeUndefined();
        expect(output.executedCommands).toHaveLength(2);
      });
    });

    describe('실패 시나리오', () => {
      it('Claude CLI 실행 실패 시 에러가 발생해야 한다', async () => {
        // Given: Claude CLI 실행 실패
        mockedExec.mockImplementationOnce((command: string, options: any, callback: any) => {
          process.nextTick(() => callback(new Error('Claude CLI execution failed'), null));
          return {} as any;
        });

        const prompt = '에러를 발생시켜주세요';
        const workspaceDir = '/tmp/test-workspace';

        // When & Then: 에러 발생
        await expect(claudeDeveloper.executePrompt(prompt, workspaceDir))
          .rejects
          .toThrow(DeveloperError);

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Claude Developer execution failed',
          expect.any(Object)
        );
      });

      it('타임아웃 시 에러가 발생해야 한다', async () => {
        // Given: 타임아웃 설정
        claudeDeveloper.setTimeout(1000);
        
        mockedExec.mockImplementationOnce((command: string, options: any, callback: any) => {
          // 타임아웃을 시뮬레이션하기 위해 콜백을 지연시킴
          setTimeout(() => {
            callback(new Error('timeout'), null);
          }, 2000);
          return {} as any;
        });

        const prompt = '오래 걸리는 작업';
        const workspaceDir = '/tmp/test-workspace';

        // When & Then: 타임아웃 에러
        await expect(claudeDeveloper.executePrompt(prompt, workspaceDir))
          .rejects
          .toThrow(DeveloperError);
      });

      it('초기화되지 않은 상태에서 실행 시 에러가 발생해야 한다', async () => {
        // Given: 초기화되지 않은 Developer
        const uninitializedDeveloper = new ClaudeDeveloper(config, { logger: mockLogger });

        // When & Then: 에러 발생
        await expect(uninitializedDeveloper.executePrompt('test', '/tmp'))
          .rejects
          .toThrow(new DeveloperError(
            'Claude Developer not initialized',
            DeveloperErrorCode.NOT_AVAILABLE,
            'claude'
          ));
      });
    });

    describe('환경 변수 설정', () => {
      it('Claude API 키가 환경 변수로 전달되어야 한다', async () => {
        // Given: 프롬프트 준비
        mockedExec.mockImplementationOnce((command: string, options: any, callback: any) => {
          process.nextTick(() => callback(null, { stdout: '작업 완료', stderr: '' }));
          return {} as any;
        });

        // When: 프롬프트 실행
        await claudeDeveloper.executePrompt('test prompt', '/tmp/workspace');

        // Then: 환경 변수 확인
        expect(mockedExec).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            env: expect.objectContaining({
              ANTHROPIC_API_KEY: 'test-api-key'
            })
          }),
          expect.any(Function)
        );
      });
    });
  });

  describe('타임아웃 설정', () => {
    it('타임아웃을 설정할 수 있어야 한다', async () => {
      // Given: 초기화
      mockedExec.mockImplementationOnce((command: string, options: any, callback: any) => {
        process.nextTick(() => callback(null, { stdout: 'claude version 1.0.0', stderr: '' }));
        return {} as any;
      });
      await claudeDeveloper.initialize();

      // When: 타임아웃 설정
      claudeDeveloper.setTimeout(5000);

      // Then: 로그 확인
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Claude Developer timeout set',
        { timeoutMs: 5000 }
      );
    });
  });

  describe('정리', () => {
    it('리소스를 정리해야 한다', async () => {
      // Given: 초기화된 상태
      mockedExec.mockImplementationOnce((command: string, options: any, callback: any) => {
        process.nextTick(() => callback(null, { stdout: 'claude version 1.0.0', stderr: '' }));
        return {} as any;
      });
      await claudeDeveloper.initialize();

      // When: 정리
      await claudeDeveloper.cleanup();

      // Then: 사용 불가능 상태
      const isAvailable = await claudeDeveloper.isAvailable();
      expect(isAvailable).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith('Claude Developer cleaned up');
    });
  });

  describe('명령어 구성', () => {
    it('올바른 Claude CLI 명령어가 구성되어야 한다', async () => {
      // Given: 초기화
      mockedExec.mockImplementationOnce((command: string, options: any, callback: any) => {
        process.nextTick(() => callback(null, { stdout: 'claude version 1.0.0', stderr: '' }));
        return {} as any;
      });
      await claudeDeveloper.initialize();

      mockedExec.mockImplementationOnce((command: string, options: any, callback: any) => {
        process.nextTick(() => callback(null, { stdout: '작업 완료', stderr: '' }));
        return {} as any;
      });

      // When: 프롬프트 실행
      const prompt = '테스트 프롬프트';
      await claudeDeveloper.executePrompt(prompt, '/tmp/workspace');

      // Then: cat 파이프 명령어 패턴 확인 (quoted claude path)
      expect(mockedExec).toHaveBeenCalledWith(
        expect.stringMatching(/^cat ".*\.txt" \| "claude" --dangerously-skip-permissions -p$/),
        expect.objectContaining({
          cwd: '/tmp/workspace',
          timeout: 30000
        }),
        expect.any(Function)
      );
    });

    it('프롬프트가 임시 파일을 통해 전달되어야 한다', async () => {
      // Given: 초기화
      mockedExec.mockImplementationOnce((command: string, options: any, callback: any) => {
        process.nextTick(() => callback(null, { stdout: 'claude version 1.0.0', stderr: '' }));
        return {} as any;
      });
      await claudeDeveloper.initialize();

      const mockWrite = jest.spyOn(require('fs/promises'), 'writeFile').mockResolvedValue(undefined);
      const mockUnlink = jest.spyOn(require('fs/promises'), 'unlink').mockResolvedValue(undefined);

      mockedExec.mockImplementationOnce((command: string, options: any, callback: any) => {
        process.nextTick(() => callback(null, { stdout: '작업 완료', stderr: '' }));
        return {} as any;
      });

      // When: 프롬프트 실행
      const prompt = '이 "코드"를 분석해주세요';
      await claudeDeveloper.executePrompt(prompt, '/tmp/workspace');

      // Then: 파일 쓰기와 삭제가 호출되어야 함
      expect(mockWrite).toHaveBeenCalledWith(
        expect.stringMatching(/.*claude-prompt-.*\.txt$/),
        prompt,
        'utf-8'
      );
      expect(mockUnlink).toHaveBeenCalledWith(
        expect.stringMatching(/.*claude-prompt-.*\.txt$/)
      );

      mockWrite.mockRestore();
      mockUnlink.mockRestore();
    });
  });
});
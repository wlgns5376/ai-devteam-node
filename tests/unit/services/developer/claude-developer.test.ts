// Mock execAsync for promisified exec - declare globally
const mockExecAsync = jest.fn();

// util mock for promisify - must be before other imports
jest.mock('util', () => ({
  ...jest.requireActual('util'),
  promisify: jest.fn(() => mockExecAsync)
}));

// child_process mock
jest.mock('child_process');

// fs/promises mock
jest.mock('fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(''),
  mkdir: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([])
}));

// os mock
jest.mock('os', () => ({
  tmpdir: jest.fn(() => '/tmp')
}));

// ContextFileManager mock
const mockCleanupContextFiles = jest.fn().mockResolvedValue(undefined);
jest.mock('@/services/developer/context-file-manager', () => ({
  ContextFileManager: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    createContextFile: jest.fn().mockResolvedValue('test-context-file.md'),
    cleanupContextFiles: mockCleanupContextFiles,
    getContextFilePath: jest.fn().mockReturnValue('/tmp/test-context.md'),
    splitLongContext: jest.fn().mockResolvedValue([]),
    shouldSplitContext: jest.fn().mockReturnValue(false),
    generateFileReference: jest.fn().mockImplementation((path, desc) => `@${path}`)
  }))
}));

import { ClaudeDeveloper } from '@/services/developer/claude-developer';
import { Logger } from '@/services/logger';
import { 
  DeveloperConfig, 
  DeveloperOutput, 
  DeveloperErrorCode,
  DeveloperError
} from '@/types/developer.types';
import { exec, spawn } from 'child_process';

const mockedExec = jest.mocked(exec);
const mockedSpawn = jest.mocked(spawn);

// Mock spawn helper
const createMockSpawn = (stdout: string, stderr: string = '', exitCode: number = 0, signal?: string) => {
  interface Callbacks {
    close: Function[];
    exit: Function[];
    error: Function[];
  }
  const callbacks: Callbacks = {
    close: [],
    exit: [],
    error: []
  };
  
  const mockChildProcess: any = {
    stdout: {
      on: jest.fn((event, callback) => {
        if (event === 'data' && stdout) {
          // 데이터를 약간의 지연 후 전송
          setTimeout(() => callback(stdout), 1);
        }
      })
    },
    stderr: {
      on: jest.fn((event, callback) => {
        if (event === 'data' && stderr) {
          // 데이터를 약간의 지연 후 전송
          setTimeout(() => callback(stderr), 1);
        }
      })
    },
    stdin: {
      end: jest.fn()
    },
    on: jest.fn((event, callback) => {
      if (event === 'close') {
        callbacks.close.push(callback);
        // 정상 종료 시 close 이벤트 발생 (약간의 지연 추가)
        setTimeout(() => callback(exitCode, signal), 10);
      } else if (event === 'exit') {
        callbacks.exit.push(callback);
        // exit 이벤트 등록
        setTimeout(() => callback(), 5);
      } else if (event === 'error') {
        callbacks.error.push(callback);
      }
      return mockChildProcess;
    }),
    once: jest.fn((event, callback) => {
      if (event === 'exit') {
        callbacks.exit.push(callback);
        // exit 이벤트 발생
        setTimeout(() => callback(), 5);
      }
      return mockChildProcess;
    }),
    removeListener: jest.fn(),
    kill: jest.fn(),
    killed: false,
    exitCode: exitCode === 0 ? 0 : null,
    pid: 12345
  };
  
  return mockChildProcess as any;
};

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
    
    // contextFileManager mock 설정
    (claudeDeveloper as any).contextFileManager = {
      cleanupContextFiles: mockCleanupContextFiles
    };
    
    // Mock 기본 설정
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('프로세스 관리', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    describe('프로세스 그룹 종료', () => {
      it('타임아웃 시 프로세스 그룹 전체를 종료해야 한다', async () => {
        // Given: 타임아웃이 발생하는 긴 실행 명령 (fake timer 사용하지 않음)
        const mockChildProcess: any = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          stdin: { end: jest.fn() },
          on: jest.fn((event, callback) => {
            // close 이벤트를 등록만 하고 호출하지 않음 (타임아웃 시뮬레이션)
            return mockChildProcess;
          }),
          once: jest.fn((event, callback) => {
            // exit 이벤트를 등록하지만 호출하지 않음
            return mockChildProcess;
          }),
          removeListener: jest.fn(),
          kill: jest.fn(),
          killed: false,
          exitCode: null,
          pid: 54321
        };
        
        mockedSpawn.mockReturnValue(mockChildProcess as any);

        // process.kill mock
        const processKillSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

        // When: 짧은 타임아웃으로 실행
        const shortTimeoutDeveloper = new ClaudeDeveloper(
          { ...config, timeoutMs: 10 },
          { logger: mockLogger }
        );
        
        // 초기화
        mockExecAsync.mockResolvedValueOnce({ stdout: 'claude version 1.0.0', stderr: '' });
        await shortTimeoutDeveloper.initialize();
        
        // Then: 타임아웃 에러 발생 및 프로세스 그룹 종료
        await expect(shortTimeoutDeveloper.executePrompt('sleep 10', '/tmp')).rejects.toThrow('Claude execution timeout');
        
        // 짧은 대기 후 프로세스 그룹 종료 확인
        await new Promise(resolve => setTimeout(resolve, 20));
        
        // 프로세스 그룹 종료 (-pid로 호출)
        expect(processKillSpy).toHaveBeenCalledWith(-54321, 'SIGTERM');

        // Cleanup
        processKillSpy.mockRestore();
      });

      it('정상 종료 시에는 프로세스 그룹 종료를 호출하지 않아야 한다', async () => {
        // Given: 정상적으로 완료되는 명령
        const mockChildProcess = createMockSpawn('output', '', 0);
        mockedSpawn.mockReturnValue(mockChildProcess);

        // process.kill mock
        const processKillSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

        // 초기화
        mockExecAsync.mockResolvedValueOnce({ stdout: 'claude version 1.0.0', stderr: '' });
        await claudeDeveloper.initialize();

        // When: 정상 실행
        await claudeDeveloper.executePrompt('echo "test"', '/tmp').catch(() => {
          // 이 테스트의 주 목적은 processKillSpy 호출 여부를 확인하는 것이므로
          // 모의(mock) 객체 불완전으로 인한 에러는 무시합니다.
        });
        
        // 프로세스 그룹 종료가 호출되지 않았는지 확인
        expect(processKillSpy).not.toHaveBeenCalled();

        // Cleanup
        processKillSpy.mockRestore();
      });

      it('SIGKILL 전송 전에 프로세스 그룹 종료를 시도해야 한다', async () => {
        // Given: SIGTERM으로 종료되지 않는 프로세스
        jest.useFakeTimers();
        
        const mockChildProcess = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          stdin: { end: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'close') {
              // 타임아웃 후 close 이벤트 발생
              setTimeout(() => callback(null, 'SIGKILL'), 6000);
            }
          }),
          once: jest.fn((event, callback) => {
            // exit 이벤트 발생하지 않음 (타임아웃 테스트)
          }),
          removeListener: jest.fn(),
          kill: jest.fn(),
          killed: false,
          pid: 99999,
          exitCode: null
        };
        
        mockedSpawn.mockReturnValue(mockChildProcess as any);

        // process.kill mock
        const processKillSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
        
        // execAsync mock for killProcessGroup (Windows case)
        mockExecAsync.mockImplementation(() => Promise.resolve({ stdout: '', stderr: '' }));

        // When: 타임아웃이 짧은 개발자 인스턴스로 실행
        const shortTimeoutDeveloper = new ClaudeDeveloper(
          { ...config, timeoutMs: 50 },
          { logger: mockLogger }
        );
        
        // 초기화
        mockExecAsync.mockResolvedValueOnce({ stdout: 'claude version 1.0.0', stderr: '' });
        await shortTimeoutDeveloper.initialize();
        
        const executePromise = shortTimeoutDeveloper.executePrompt('sleep 10', '/tmp').catch(e => e);

        // 프로세스가 시작될 때까지 대기
        await new Promise(resolve => setImmediate(resolve));
        
        // 타임아웃 발생
        jest.advanceTimersByTime(51);
        
        // Then: 프로세스 그룹에 SIGTERM 전송
        await new Promise(resolve => setImmediate(resolve));
        expect(processKillSpy).toHaveBeenCalledWith(-99999, 'SIGTERM');

        // 5초 후 SIGKILL 전송
        jest.advanceTimersByTime(5000);
        await new Promise(resolve => setImmediate(resolve));
        expect(processKillSpy).toHaveBeenCalledWith(-99999, 'SIGKILL');

        // 프로세스 종료 시뮬레이션
        const closeCallback = mockChildProcess.on.mock.calls.find(
          call => call[0] === 'close'
        )?.[1];
        if (closeCallback) {
          closeCallback(null, 'SIGKILL');
        }
        
        // 타임아웃 처리 시간 허용
        jest.advanceTimersByTime(100);
        
        const result = await executePromise;
        expect(result).toBeInstanceOf(Error);
        expect(result.message).toContain('timeout');

        // Cleanup
        jest.useRealTimers();
        processKillSpy.mockRestore();
      }, 20000);
    });

    describe('Graceful Shutdown', () => {
      it('cleanup 메서드가 모든 활성 프로세스를 종료해야 한다', async () => {
        jest.useFakeTimers();
        
        // execAsync mock for killProcessGroup (Windows case)
        mockExecAsync.mockImplementation(() => Promise.resolve({ stdout: '', stderr: '' }));
        
        // Given: 여러 프로세스가 실행 중
        const mockProcesses: any[] = [];
        for (let i = 0; i < 3; i++) {
          const mockProcess = createMockSpawn('', '', 0);
          mockProcess.pid = 1000 + i;
          mockProcess.killed = false;
          mockProcess.on = jest.fn((event, callback) => {
            // 'close' 이벤트 등 다른 이벤트 처리
            return mockProcess;
          });
          mockProcess.once = jest.fn((event, callback) => {
            if (event === 'exit') {
              setTimeout(() => {
                callback();
              }, 50);
            }
            return mockProcess;
          });
          mockProcess.removeListener = jest.fn();
          mockProcess.exitCode = null;
          mockProcesses.push(mockProcess);
        }

        let processIndex = 0;
        mockedSpawn.mockImplementation(() => {
          return mockProcesses[processIndex++] || mockProcesses[0];
        });

        // process.kill mock
        const processKillSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

        // 여러 프로세스 시작 (타임아웃을 길게 설정하여 cleanup 전까지 실행 유지)
        const longTimeoutDeveloper = new ClaudeDeveloper(
          { ...config, timeoutMs: 10000 },
          { logger: mockLogger }
        );
        
        // contextFileManager mock 설정
        (longTimeoutDeveloper as any).contextFileManager = {
          cleanupContextFiles: mockCleanupContextFiles
        };
        
        // 초기화
        mockExecAsync.mockResolvedValueOnce({ stdout: 'claude version 1.0.0', stderr: '' });
        await longTimeoutDeveloper.initialize();

        const promises = [
          longTimeoutDeveloper.executePrompt('sleep 10', '/tmp').catch(() => {}),
          longTimeoutDeveloper.executePrompt('sleep 10', '/tmp').catch(() => {}),
          longTimeoutDeveloper.executePrompt('sleep 10', '/tmp').catch(() => {})
        ];

        // 프로세스가 시작될 때까지 대기
        await new Promise(resolve => process.nextTick(resolve));
        jest.advanceTimersByTime(10);

        // When: cleanup 호출 (cleanupActiveProcesses가 내부적으로 호출됨)
        const cleanupPromise = longTimeoutDeveloper.cleanup();
        
        // exit 이벤트 발생 시뮬레이션
        jest.advanceTimersByTime(100);
        await Promise.resolve(); // Let promises resolve
        jest.advanceTimersByTime(100);
        
        await cleanupPromise;

        // Then: 모든 프로세스가 종료되어야 함
        mockProcesses.forEach((mockProcess, index) => {
          // cleanup은 이제 프로세스 그룹에만 시그널을 보냄
          expect(processKillSpy).toHaveBeenCalledWith(-(1000 + index), 'SIGTERM');
        });

        // Cleanup
        jest.useRealTimers();
        processKillSpy.mockRestore();
      }, 10000);

      it('cleanup 중 프로세스 종료 실패를 처리해야 한다', async () => {
        jest.useFakeTimers();
        
        // execAsync mock for killProcessGroup (Windows case) - reject for error case
        mockExecAsync.mockImplementation(() => Promise.reject(new Error('Operation not permitted')));
        
        // Given: 종료할 수 없는 프로세스
        const stubProcess: any = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          stdin: { end: jest.fn() },
          on: jest.fn(),
          once: jest.fn((event, callback) => {
            // exit 이벤트는 발생하지 않음 (타임아웃 테스트)
            return stubProcess;
          }),
          removeListener: jest.fn(),
          killed: false,
          exitCode: null,
          pid: 55555
        };

        mockedSpawn.mockReturnValue(stubProcess as any);

        // process.kill mock
        const processKillSpy = jest.spyOn(process, 'kill').mockImplementation(() => {
          throw new Error('Operation not permitted');
        });
        
        // contextFileManager mock 설정
        (claudeDeveloper as any).contextFileManager = {
          cleanupContextFiles: mockCleanupContextFiles
        };
        
        // 초기화
        mockExecAsync.mockResolvedValueOnce({ stdout: 'claude version 1.0.0', stderr: '' });
        await claudeDeveloper.initialize();

        // When: 프로세스 시작 후 cleanup
        const executePromise = claudeDeveloper.executePrompt('sleep 10', '/tmp').catch(() => {});
        jest.advanceTimersByTime(10);
        
        // cleanup 호출 (cleanupActiveProcesses가 내부적으로 호출됨)
        const cleanupPromise = claudeDeveloper.cleanup();
        
        // 타임아웃 발생 시뮬레이션
        jest.advanceTimersByTime(1000);
        await Promise.resolve(); // Let promises resolve
        jest.advanceTimersByTime(100);
        
        // cleanup이 완료되어야 함 (에러를 throw하지 않음)
        await cleanupPromise;

        // Then: 경고 로그가 기록되어야 함
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Failed to cleanup process',
          expect.objectContaining({
            pid: 55555
          })
        );

        // Cleanup
        jest.useRealTimers();
        processKillSpy.mockRestore();
      }, 10000);
    });
  });

  describe('초기화', () => {
    it('성공적으로 초기화되어야 한다', async () => {
      // Given: Claude CLI 설치 확인 성공
      mockExecAsync.mockResolvedValueOnce({ stdout: 'claude version 1.0.0', stderr: '' });

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
      mockExecAsync.mockRejectedValueOnce(new Error('command not found: claude'));
      
      // 두 번째 시도도 실패
      mockExecAsync.mockRejectedValueOnce(new Error('command not found: claude'));

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
      mockExecAsync.mockResolvedValueOnce({ stdout: 'claude help output', stderr: '' });
      
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
      mockExecAsync.mockResolvedValueOnce({ stdout: 'claude version 1.0.0', stderr: '' });
      
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

        // spawn mock 설정
        const mockChildProcess = createMockSpawn(mockOutput);
        mockedSpawn.mockReturnValueOnce(mockChildProcess);

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
        
        // spawn 명령어 실행 확인
        expect(mockedSpawn).toHaveBeenCalledWith(
          'bash',
          ['-c', expect.stringMatching(/cat ".*claude-prompt-.*\.txt" \| "claude" --dangerously-skip-permissions -p/)],
          expect.objectContaining({
            cwd: workspaceDir,
            env: expect.objectContaining({
              ANTHROPIC_API_KEY: 'test-api-key'
            }),
            stdio: ['pipe', 'pipe', 'pipe']
          })
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

        // spawn mock 설정
        const mockChildProcess = createMockSpawn(mockOutput);
        mockedSpawn.mockReturnValueOnce(mockChildProcess);

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
        const mockChildProcess = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          stdin: { end: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'error') {
              process.nextTick(() => callback(new Error('Claude CLI execution failed')));
            }
          }),
          once: jest.fn(),
          removeListener: jest.fn(),
          kill: jest.fn(),
          killed: false,
          exitCode: null,
          pid: 12345
        };
        mockedSpawn.mockReturnValueOnce(mockChildProcess as any);

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
        claudeDeveloper.setTimeout(100); // 매우 짧은 타임아웃으로 설정
        
        // 타임아웃을 테스트하기 위해 응답하지 않는 프로세스 모킹
        const mockChildProcess = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          stdin: { end: jest.fn() },
          on: jest.fn(), // 'close' 이벤트를 발생시키지 않음
          once: jest.fn(),
          removeListener: jest.fn(),
          kill: jest.fn(),
          killed: false,
          exitCode: null,
          pid: 12345
        };
        mockedSpawn.mockReturnValueOnce(mockChildProcess as any);

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
        const mockOutput = `작업을 수행했습니다.
        
$ echo "Test complete"
Test complete

작업을 완료했습니다!`;
        const mockChildProcess = createMockSpawn(mockOutput);
        mockedSpawn.mockReturnValueOnce(mockChildProcess);

        // When: 프롬프트 실행
        await claudeDeveloper.executePrompt('test prompt', '/tmp/workspace');

        // Then: 환경 변수 확인
        expect(mockedSpawn).toHaveBeenCalledWith(
          'bash',
          expect.any(Array),
          expect.objectContaining({
            env: expect.objectContaining({
              ANTHROPIC_API_KEY: 'test-api-key'
            })
          })
        );
      });
    });
  });

  describe('타임아웃 설정', () => {
    it('타임아웃을 설정할 수 있어야 한다', async () => {
      // Given: 초기화
      mockExecAsync.mockResolvedValueOnce({ stdout: 'claude version 1.0.0', stderr: '' });
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
      mockExecAsync.mockResolvedValueOnce({ stdout: 'claude version 1.0.0', stderr: '' });
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
      mockExecAsync.mockResolvedValueOnce({ stdout: 'claude version 1.0.0', stderr: '' });
      await claudeDeveloper.initialize();

      const mockOutput = `작업을 수행했습니다.

$ echo "Test complete"
Test complete

작업을 완료했습니다!`;
      const mockChildProcess = createMockSpawn(mockOutput);
      mockedSpawn.mockReturnValueOnce(mockChildProcess);

      // When: 프롬프트 실행
      const prompt = '테스트 프롬프트';
      await claudeDeveloper.executePrompt(prompt, '/tmp/workspace');

      // Then: spawn으로 bash 명령어 패턴 확인
      expect(mockedSpawn).toHaveBeenCalledWith(
        'bash',
        ['-c', expect.stringMatching(/cat ".*\.txt" \| "claude" --dangerously-skip-permissions -p/)],
        expect.objectContaining({
          cwd: '/tmp/workspace',
          stdio: ['pipe', 'pipe', 'pipe']
        })
      );
    });

    it('프롬프트가 임시 파일을 통해 전달되어야 한다', async () => {
      // Given: 초기화
      mockExecAsync.mockResolvedValueOnce({ stdout: 'claude version 1.0.0', stderr: '' });
      await claudeDeveloper.initialize();

      const mockWrite = jest.spyOn(require('fs/promises'), 'writeFile').mockResolvedValue(undefined);
      const mockUnlink = jest.spyOn(require('fs/promises'), 'unlink').mockResolvedValue(undefined);

      const mockOutput = `작업을 수행했습니다.

$ echo "Code analyzed"
Code analyzed

작업을 완료했습니다!`;
      const mockChildProcess = createMockSpawn(mockOutput);
      mockedSpawn.mockReturnValueOnce(mockChildProcess);

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
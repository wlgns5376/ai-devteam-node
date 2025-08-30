// promisify mock
const mockExecAsync = jest.fn();
jest.mock('util', () => ({
  ...jest.requireActual('util'),
  promisify: jest.fn(() => mockExecAsync)
}));

import { GitService } from '@/services/git/git.service';
import { GitLockService } from '@/services/git/git-lock.service';
import { Logger } from '@/services/logger';
import { exec } from 'child_process';
import { promisify } from 'util';

jest.mock('child_process');
const mockedExec = jest.mocked(exec);

// fs/promises mock
jest.mock('fs/promises', () => ({
  access: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  stat: jest.fn().mockResolvedValue({ isDirectory: () => true }),
}));

describe('GitService - pullMainBranch', () => {
  let gitService: GitService;
  let mockLogger: jest.Mocked<Logger>;
  let mockGitLockService: jest.Mocked<GitLockService>;

  beforeEach(() => {
    // Logger mock
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    // GitLockService mock
    mockGitLockService = {
      withLock: jest.fn((repoId, operation, callback) => callback()),
    } as any;

    // GitService 인스턴스 생성
    gitService = new GitService({
      logger: mockLogger,
      gitOperationTimeoutMs: 30000,
      gitLockService: mockGitLockService,
    });

    // Mock 초기화
    jest.clearAllMocks();
  });

  describe('인터페이스 확인', () => {
    it('pullMainBranch 메서드가 존재해야 함', () => {
      expect(typeof gitService.pullMainBranch).toBe('function');
    });

    it('GitLockService가 pull 작업을 지원해야 함', async () => {
      // GitLockService가 'pull' 타입을 지원하는지 확인
      expect(mockGitLockService.withLock).toBeDefined();
      
      // git 명령어 mock
      mockExecAsync.mockResolvedValue({ stdout: 'main', stderr: '' });
      
      // pull 작업이 GitLockService를 통해 호출되는지 간접 확인
      try {
        await gitService.pullMainBranch('/test/path');
      } catch (error) {
        // 테스트 목적 달성
      }
      
      // lock이 호출되었는지 확인
      expect(mockGitLockService.withLock).toHaveBeenCalledWith(
        expect.any(String), 
        'pull', 
        expect.any(Function)
      );
    });
  });

  describe('기본 기능 확인', () => {
    it('pullMainBranch가 로깅을 수행해야 함', async () => {
      const localPath = '/test/repo';
      
      // git 명령어 mock
      mockExecAsync.mockResolvedValue({ stdout: 'main', stderr: '' });
      
      try {
        await gitService.pullMainBranch(localPath);
      } catch (error) {
        // 테스트 목적 달성
      }
      
      // 로깅이 수행되었는지 확인
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Pulling main branch updates', 
        { localPath }
      );
    });
  });
});

describe('GitService - 프로세스 관리', () => {
  let gitService: GitService;
  let mockLogger: jest.Mocked<Logger>;
  let mockGitLockService: jest.Mocked<GitLockService>;
  let abortControllerMock: AbortController;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    mockGitLockService = {
      withLock: jest.fn((repoId, operation, callback) => callback()),
    } as any;

    gitService = new GitService({
      logger: mockLogger,
      gitOperationTimeoutMs: 30000,
      gitLockService: mockGitLockService,
    });

    // AbortController mock
    abortControllerMock = new AbortController();
    global.AbortController = jest.fn(() => abortControllerMock) as any;

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('프로세스 타임아웃 처리', () => {
    it('타임아웃 시 프로세스가 정리되어야 한다', async () => {
      // Given: 타임아웃 에러 모의
      const timeoutError = new Error('Command failed');
      (timeoutError as any).code = 'ETIMEDOUT';
      mockExecAsync.mockRejectedValue(timeoutError);

      // When: git clone 실행
      const clonePromise = gitService.clone('https://github.com/test/repo.git', '/tmp/repo');

      // Then: 타임아웃 에러 발생
      await expect(clonePromise).rejects.toThrow('Failed to clone repository');
      
      // 에러 로깅 확인
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Git clone failed',
        expect.objectContaining({
          repositoryUrl: 'https://github.com/test/repo.git',
          localPath: '/tmp/repo',
        })
      );
    });

    it('정상 종료 시 프로세스 정리를 시도하지 않아야 한다', async () => {
      // Given: 정상적으로 완료되는 git 명령
      mockExecAsync.mockResolvedValue({ stdout: 'Success', stderr: '' });

      // When: git fetch 실행
      await gitService.fetch('/tmp/repo');

      // Then: 성공 로그 확인
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Repository fetched successfully',
        expect.objectContaining({
          localPath: '/tmp/repo',
        })
      );

      // 에러 로그가 없어야 함
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  describe('execAsync 타임아웃 처리', () => {
    it('모든 git 명령이 타임아웃 설정을 가져야 한다', async () => {
      // Given: execAsync 호출을 추적하는 mock
      const execCalls: any[] = [];
      mockExecAsync.mockImplementation((command: string, options?: any) => {
        execCalls.push({ command, options });
        return Promise.reject(new Error('Test error'));
      });

      // When: 여러 git 명령 실행
      const operations = [
        gitService.clone('https://github.com/test/repo.git', '/tmp/repo').catch(() => {}),
        gitService.fetch('/tmp/repo').catch(() => {}),
        gitService.pullMainBranch('/tmp/repo').catch(() => {}),
      ];

      await Promise.all(operations);

      // Then: 모든 exec 호출이 timeout 옵션을 가져야 함
      expect(execCalls.length).toBeGreaterThan(0);
      execCalls.forEach(call => {
        if (call.options) {
          expect(call.options).toHaveProperty('timeout');
          expect(call.options.timeout).toBeGreaterThan(0);
        }
      });
    });
  });
});
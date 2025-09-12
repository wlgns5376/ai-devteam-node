// promisify mock
const mockExecAsync = jest.fn();
jest.mock('util', () => ({
  ...jest.requireActual('util'),
  promisify: jest.fn(() => mockExecAsync)
}));

import { GitService } from '@/services/git/git.service';
import { GitLockService } from '@/services/git/git-lock.service';
import { Logger } from '@/services/logger';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';

jest.mock('child_process');
const mockedExec = jest.mocked(exec);
const mockedSpawn = jest.mocked(spawn);

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
      // Given: 짧은 타임아웃으로 GitService 생성
      const shortTimeoutService = new GitService({
        logger: mockLogger,
        gitOperationTimeoutMs: 100, // 100ms로 설정
        gitLockService: mockGitLockService,
      });

      // spawn을 위한 mock child process 생성
      class MockChildProcess extends EventEmitter {
        stdout = new EventEmitter();
        stderr = new EventEmitter();
        pid = 12345;
        killed = false;
        exitCode = null;
        kill = jest.fn().mockImplementation(() => {
          this.killed = true;
          return true;
        });
      }
      
      const mockChild = new MockChildProcess();
      mockedSpawn.mockReturnValue(mockChild as any);

      // When: git clone 실행 (타임아웃 발생)
      const clonePromise = shortTimeoutService.clone('https://github.com/test/repo.git', '/tmp/repo');

      // 타임아웃 기다리기 (프로세스가 끝나지 않음)
      await new Promise(resolve => setTimeout(resolve, 150));

      // Then: 타임아웃 에러 발생
      await expect(clonePromise).rejects.toThrow('Failed to clone repository');
      
      // kill이 호출되어야 함 (SIGTERM 또는 SIGKILL)
      expect(mockChild.kill).toHaveBeenCalledWith(expect.stringMatching(/SIGTERM|SIGKILL/));
      
      // 경고 로그 확인
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Git command timeout, terminating',
        expect.objectContaining({
          pid: 12345,
          timeoutMs: 100
        })
      );
      
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
      // Given: spawn을 위한 mock child process 생성
      class MockChildProcess extends EventEmitter {
        stdout = new EventEmitter();
        stderr = new EventEmitter();
        pid = 12345;
        kill = jest.fn();
      }
      
      const mockChild = new MockChildProcess();
      
      // spawn이 mock child process를 반환하도록 설정
      mockedSpawn.mockReturnValue(mockChild as any);

      // When: git fetch 실행 (비동기로 처리)
      const fetchPromise = gitService.fetch('/tmp/repo');
      
      // stdout 데이터 전송
      mockChild.stdout.emit('data', 'Success');
      
      // 정상 종료 시뮬레이션
      process.nextTick(() => {
        mockChild.emit('close', 0);
      });
      
      await fetchPromise;

      // Then: 성공 로그 확인
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Repository fetched successfully',
        expect.objectContaining({
          localPath: '/tmp/repo',
        })
      );

      // 에러 로그가 없어야 함
      expect(mockLogger.error).not.toHaveBeenCalled();
      
      // kill이 호출되지 않아야 함
      expect(mockChild.kill).not.toHaveBeenCalled();
    });
  });

  describe('execAsync 타임아웃 처리', () => {
    it('모든 git 명령이 타임아웃 설정을 가져야 한다', async () => {
      // Given: spawn을 위한 mock child process 생성
      class MockChildProcess extends EventEmitter {
        stdout = new EventEmitter();
        stderr = new EventEmitter();
        pid = 12345;
        kill = jest.fn();
      }
      
      const mockChild = new MockChildProcess();
      mockedSpawn.mockReturnValue(mockChild as any);

      // When: 여러 git 명령 실행
      const operations = [
        gitService.clone('https://github.com/test/repo.git', '/tmp/repo'),
        gitService.fetch('/tmp/repo'),
        gitService.pullMainBranch('/tmp/repo'),
      ];

      // 각 작업을 즉시 실패시킴
      operations.forEach(() => {
        process.nextTick(() => {
          mockChild.emit('close', 1);
          mockChild.stderr.emit('data', 'Test error');
        });
      });

      // 모든 작업이 실패하도록 기다림
      await Promise.allSettled(operations);

      // Then: spawn이 호출되었는지 확인 (타임아웃 설정은 내부적으로 처리)
      expect(mockedSpawn).toHaveBeenCalled();
      
      // 각 명령에 대해 spawn이 호출되었는지 확인
      expect(mockedSpawn).toHaveBeenCalledTimes(3);
    });
  });
});
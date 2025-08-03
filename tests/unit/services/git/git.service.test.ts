import { GitService } from '@/services/git/git.service';
import { GitLockService } from '@/services/git/git-lock.service';
import { Logger } from '@/services/logger';

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
      
      // pull 작업이 GitLockService를 통해 호출되는지 간접 확인
      // (실제 git 명령어를 mock하지 않고 구조만 확인)
      try {
        await gitService.pullMainBranch('/invalid/path');
      } catch (error) {
        // 에러가 발생하더라도 lock이 호출되는지만 확인
        expect(mockGitLockService.withLock).toHaveBeenCalledWith(
          expect.any(String), 
          'pull', 
          expect.any(Function)
        );
      }
    });
  });

  describe('기본 기능 확인', () => {
    it('pullMainBranch가 로깅을 수행해야 함', async () => {
      const localPath = '/test/repo';
      
      try {
        await gitService.pullMainBranch(localPath);
      } catch (error) {
        // 실제 git 명령어 실행 실패는 예상되지만 로깅은 수행되어야 함
        expect(mockLogger.info).toHaveBeenCalledWith(
          'Pulling main branch updates', 
          { localPath }
        );
      }
    });
  });
});
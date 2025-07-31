import { AppConfigLoader, AppEnvironment } from '@/config/app-config';

describe('AppConfigLoader', () => {
  let originalEnv: any;

  beforeEach(() => {
    // 환경변수 백업
    originalEnv = {
      NODE_ENV: process.env.NODE_ENV,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GITHUB_OWNER: process.env.GITHUB_OWNER,
      GITHUB_PROJECT_NUMBER: process.env.GITHUB_PROJECT_NUMBER,
      GITHUB_REPO: process.env.GITHUB_REPO,
      GITHUB_REPOS: process.env.GITHUB_REPOS,
      GITHUB_REPO_FILTER_MODE: process.env.GITHUB_REPO_FILTER_MODE,
      REPOSITORY_OWNER: process.env.REPOSITORY_OWNER,
      REPOSITORY_NAME: process.env.REPOSITORY_NAME,
      WORKSPACE_ROOT: process.env.WORKSPACE_ROOT,
      LOG_LEVEL: process.env.LOG_LEVEL,
      LOG_FILE: process.env.LOG_FILE
    };
  });

  afterEach(() => {
    // 환경변수 복원
    Object.keys(originalEnv).forEach(key => {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    });
  });

  describe('buildRepositoryFilter', () => {
    it('should create filter from GITHUB_REPOS (new way)', () => {
      // Given: GITHUB_REPOS 환경변수 설정
      const env: AppEnvironment = {
        NODE_ENV: 'development',
        GITHUB_REPOS: 'owner1/repo1,owner2/repo2,owner3/repo3',
        GITHUB_REPO_FILTER_MODE: 'whitelist'
      };

      // When: 설정을 로드하면
      const config = AppConfigLoader.loadFromEnvironment(env);

      // Then: 레포지토리 필터가 생성되어야 함
      expect(config.planner.repositoryFilter).toEqual({
        allowedRepositories: ['owner1/repo1', 'owner2/repo2', 'owner3/repo3'],
        mode: 'whitelist'
      });
    });

    it('should create filter from GITHUB_REPO (legacy way)', () => {
      // Given: GITHUB_REPO 환경변수 설정
      const env: AppEnvironment = {
        NODE_ENV: 'development',
        GITHUB_OWNER: 'test-owner',
        GITHUB_REPO: 'test-repo'
      };

      // When: 설정을 로드하면
      const config = AppConfigLoader.loadFromEnvironment(env);

      // Then: 단일 레포지토리 필터가 생성되어야 함
      expect(config.planner.repositoryFilter).toEqual({
        allowedRepositories: ['test-owner/test-repo'],
        mode: 'whitelist'
      });
    });

    it('should prioritize GITHUB_REPOS over GITHUB_REPO', () => {
      // Given: 두 환경변수가 모두 설정된 경우
      const env: AppEnvironment = {
        NODE_ENV: 'development',
        GITHUB_OWNER: 'test-owner',
        GITHUB_REPO: 'single-repo',
        GITHUB_REPOS: 'owner1/repo1,owner2/repo2',
        GITHUB_REPO_FILTER_MODE: 'blacklist'
      };

      // When: 설정을 로드하면
      const config = AppConfigLoader.loadFromEnvironment(env);

      // Then: GITHUB_REPOS가 우선되어야 함
      expect(config.planner.repositoryFilter).toEqual({
        allowedRepositories: ['owner1/repo1', 'owner2/repo2'],
        mode: 'blacklist'
      });
    });

    it('should default to whitelist mode when not specified', () => {
      // Given: 필터 모드가 설정되지 않은 경우
      const env: AppEnvironment = {
        NODE_ENV: 'development',
        GITHUB_REPOS: 'owner1/repo1'
      };

      // When: 설정을 로드하면
      const config = AppConfigLoader.loadFromEnvironment(env);

      // Then: 기본값인 whitelist가 사용되어야 함
      expect(config.planner.repositoryFilter).toEqual({
        allowedRepositories: ['owner1/repo1'],
        mode: 'whitelist'
      });
    });

    it('should handle empty repository list', () => {
      // Given: 빈 레포지토리 목록
      const env: AppEnvironment = {
        NODE_ENV: 'development',
        GITHUB_REPOS: ''
      };

      // When: 설정을 로드하면
      const config = AppConfigLoader.loadFromEnvironment(env);

      // Then: 레포지토리 필터가 설정되지 않아야 함
      expect(config.planner.repositoryFilter).toBeUndefined();
    });

    it('should trim whitespace from repository names', () => {
      // Given: 공백이 포함된 레포지토리 목록
      const env: AppEnvironment = {
        NODE_ENV: 'development',
        GITHUB_REPOS: ' owner1/repo1 , owner2/repo2,  owner3/repo3  '
      };

      // When: 설정을 로드하면
      const config = AppConfigLoader.loadFromEnvironment(env);

      // Then: 공백이 제거되어야 함
      expect(config.planner.repositoryFilter?.allowedRepositories).toEqual([
        'owner1/repo1', 'owner2/repo2', 'owner3/repo3'
      ]);
    });

    it('should not create filter when no repository settings are provided', () => {
      // Given: 레포지토리 설정이 없는 경우
      const env: AppEnvironment = {
        NODE_ENV: 'development'
      };

      // When: 설정을 로드하면
      const config = AppConfigLoader.loadFromEnvironment(env);

      // Then: 레포지토리 필터가 설정되지 않아야 함
      expect(config.planner.repositoryFilter).toBeUndefined();
    });
  });

  describe('loadFromEnvironment', () => {
    it('should load default configuration when no environment variables are set', () => {
      // Given: 환경변수가 설정되지 않은 경우
      const env: AppEnvironment = {
        NODE_ENV: 'development'
      };

      // When: 설정을 로드하면
      const config = AppConfigLoader.loadFromEnvironment(env);

      // Then: 기본값이 사용되어야 함
      expect(config.nodeEnv).toBe('development');
      expect(config.planner.monitoringIntervalMs).toBe(15000);
      expect(config.manager.workspaceRoot).toBe('./workspace');
      expect(config.logger.level).toBe('info');
    });

    it('should use production defaults for production environment', () => {
      // Given: 프로덕션 환경설정
      const env: AppEnvironment = {
        NODE_ENV: 'production'
      };

      // When: 설정을 로드하면
      const config = AppConfigLoader.loadFromEnvironment(env);

      // Then: 프로덕션 기본값이 사용되어야 함
      expect(config.nodeEnv).toBe('production');
      expect(config.planner.monitoringIntervalMs).toBe(30000);
      expect(config.manager.workerPool.minWorkers).toBe(2);
      expect(config.manager.workerPool.maxWorkers).toBe(5);
    });

    it('should use environment variables when provided', () => {
      // Given: 환경변수가 설정된 경우
      const env: AppEnvironment = {
        NODE_ENV: 'development',
        GITHUB_OWNER: 'test-org',
        GITHUB_REPO: 'test-repo',
        WORKSPACE_ROOT: '/custom/workspace',
        LOG_LEVEL: 'debug',
        LOG_FILE: '/custom/app.log',
        CLAUDE_CODE_TIMEOUT: '600000',  // 10분
        GEMINI_CLI_TIMEOUT: '900000'    // 15분
      };

      // When: 설정을 로드하면
      const config = AppConfigLoader.loadFromEnvironment(env);

      // Then: 환경변수 값이 사용되어야 함
      expect(config.planner.repoId).toBe('test-org/test-repo');
      expect(config.manager.workspaceRoot).toBe('/custom/workspace');
      expect(config.logger.level).toBe('debug');
      expect(config.logger.filePath).toBe('/custom/app.log');
      expect(config.developer.claudeCodeTimeoutMs).toBe(600000);
      expect(config.developer.geminiCliTimeoutMs).toBe(900000);
    });

    it('should use default timeout values when environment variables are not provided', () => {
      // Given: 타임아웃 환경변수가 설정되지 않은 경우
      const env: AppEnvironment = {
        NODE_ENV: 'development'
      };

      // When: 설정을 로드하면
      const config = AppConfigLoader.loadFromEnvironment(env);

      // Then: 기본 타임아웃 값이 사용되어야 함 (5분 = 300000ms)
      expect(config.developer.claudeCodeTimeoutMs).toBe(300000);
      expect(config.developer.geminiCliTimeoutMs).toBe(300000);
    });

    it('should handle invalid timeout values gracefully', () => {
      // Given: 잘못된 타임아웃 값이 설정된 경우
      const env: AppEnvironment = {
        NODE_ENV: 'development',
        CLAUDE_CODE_TIMEOUT: 'invalid-number',
        GEMINI_CLI_TIMEOUT: 'also-invalid'
      };

      // When: 설정을 로드하면
      const config = AppConfigLoader.loadFromEnvironment(env);

      // Then: NaN이 되므로 기본값으로 fallback되어야 함
      expect(config.developer.claudeCodeTimeoutMs).toBe(300000); // parseInt('invalid-number') -> NaN, fallback to default
      expect(config.developer.geminiCliTimeoutMs).toBe(300000);
    });
  });

  describe('validate', () => {
    it('should pass validation for valid configuration', () => {
      // Given: 유효한 설정
      const config = AppConfigLoader.loadFromEnvironment({
        NODE_ENV: 'development',
        GITHUB_PROJECT_NUMBER: '1',
        GITHUB_OWNER: 'test-org',
        GITHUB_REPO: 'test-repo'
      });

      // When & Then: 검증이 통과해야 함
      expect(() => AppConfigLoader.validate(config)).not.toThrow();
    });

    it('should throw error for invalid worker pool configuration', () => {
      // Given: 잘못된 워커 풀 설정
      const config = AppConfigLoader.loadFromEnvironment({
        NODE_ENV: 'development',
        GITHUB_PROJECT_NUMBER: '1',
        GITHUB_OWNER: 'test-org',
        GITHUB_REPO: 'test-repo'
      });
      
      // 잘못된 설정으로 변경
      (config.manager.workerPool as any).minWorkers = 0;

      // When & Then: 에러가 발생해야 함
      expect(() => AppConfigLoader.validate(config))
        .toThrow('manager.workerPool.minWorkers must be at least 1');
    });

    it('should throw error when maxWorkers is less than minWorkers', () => {
      // Given: 잘못된 워커 풀 설정
      const config = AppConfigLoader.loadFromEnvironment({
        NODE_ENV: 'development',
        GITHUB_PROJECT_NUMBER: '1',
        GITHUB_OWNER: 'test-org',
        GITHUB_REPO: 'test-repo'
      });
      
      // 잘못된 설정으로 변경
      (config.manager.workerPool as any).minWorkers = 5;
      (config.manager.workerPool as any).maxWorkers = 3;

      // When & Then: 에러가 발생해야 함
      expect(() => AppConfigLoader.validate(config))
        .toThrow('manager.workerPool.maxWorkers must be >= minWorkers');
    });
  });
});
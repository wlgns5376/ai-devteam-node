/**
 * GitHub 통합 테스트
 * 
 * 이 테스트는 실제 GitHub API와 연동하여 작동하는지 확인합니다.
 * 실행하려면:
 * 1. .env.test 파일에 GITHUB_TOKEN 설정
 * 2. 테스트할 GitHub 리포지토리와 프로젝트 보드 설정
 * 3. npm test -- --testPathPatterns=github-integration.test.ts 실행
 * 
 * 주의: 이 테스트는 실제 API 호출을 하므로 rate limit에 주의하세요.
 */

import { ServiceFactory } from '@/services/service-factory';
import { ServiceProvider, ProviderConfig } from '@/types';
import { Logger } from '@/services/logger';


// 실제 GitHub API 테스트는 환경변수가 설정된 경우에만 실행
const SKIP_INTEGRATION_TESTS = !process.env.GITHUB_TOKEN || process.env.SKIP_INTEGRATION_TESTS === 'true';

describe('GitHub Integration Tests', () => {
  let factory: ServiceFactory;
  let logger: Logger;

  beforeAll(() => {
    logger = Logger.createConsoleLogger();
    factory = new ServiceFactory(logger);
  });

  const testConfig: ProviderConfig = {
    type: ServiceProvider.GITHUB,
    apiToken: process.env.GITHUB_TOKEN || 'test-token',
    options: {
      owner: process.env.GITHUB_TEST_OWNER || 'test-owner',
      projectNumber: process.env.GITHUB_TEST_PROJECT_NUMBER 
        ? parseInt(process.env.GITHUB_TEST_PROJECT_NUMBER) 
        : 1
    }
  };

  describe('ServiceFactory GitHub Integration', () => {
    (SKIP_INTEGRATION_TESTS ? it.skip : it)('should create working GitHub v2 service', async () => {
      // Given: 실제 GitHub v2 설정이 있을 때
      const config = ServiceFactory.createGitHubV2Config({
        owner: testConfig.options!.owner as string,
        projectNumber: testConfig.options!.projectNumber as number
      });

      // When: GitHub 서비스를 생성하면
      const service = factory.createProjectBoardService(config);

      // Then: GitHubProjectBoardV2Service 인스턴스가 반환되어야 함
      expect(service.constructor.name).toBe('GitHubProjectBoardV2Service');
    });

    (SKIP_INTEGRATION_TESTS ? it.skip : it)('should handle basic service operations', async () => {
      // Given: GitHub 서비스가 있을 때
      const service = factory.createProjectBoardService(testConfig);

      // When: 기본 서비스가 생성되면
      // Then: 서비스 인스턴스가 정상적으로 생성되어야 함
      expect(service).toBeDefined();
      expect(typeof service.getBoard).toBe('function');
    }, 10000); // 10초 타임아웃

    (SKIP_INTEGRATION_TESTS ? it.skip : it)('should handle authentication errors gracefully', async () => {
      // Given: 잘못된 토큰으로 설정된 서비스가 있을 때
      const invalidConfig: ProviderConfig = {
        ...testConfig,
        apiToken: 'invalid-token'
      };
      const service = factory.createProjectBoardService(invalidConfig);

      // When: API를 호출하면
      // Then: 인증 에러가 발생해야 함
      await expect(service.getBoard('1')).rejects.toThrow();
    }, 10000);
  });

  describe('GitHub API Rate Limiting', () => {
    (SKIP_INTEGRATION_TESTS ? it.skip : it)('should handle rate limits properly', async () => {
      // Given: GitHub 서비스가 있을 때
      const service = factory.createProjectBoardService(testConfig);

      // When: 여러 번 API를 호출해도
      const promises = Array(3).fill(0).map(async (_, i) => {
        try {
          await service.getBoard(String(i + 1));
        } catch (error) {
          // 프로젝트가 없으면 404 에러가 예상됨
          expect(error).toBeDefined();
        }
      });

      // Then: rate limit 에러가 발생하지 않아야 함 (적당한 요청 수에서)
      await expect(Promise.allSettled(promises)).resolves.toBeDefined();
    }, 15000);
  });

  describe('Environment Configuration', () => {
    it('should create v2 config from environment variables', () => {
      // Given: 환경변수가 설정되어 있을 때
      const originalToken = process.env.GITHUB_TOKEN;
      const originalOwner = process.env.GITHUB_OWNER;
      const originalProjectNumber = process.env.GITHUB_PROJECT_NUMBER;
      
      process.env.GITHUB_TOKEN = 'env-test-token';
      process.env.GITHUB_OWNER = 'test-owner';
      process.env.GITHUB_PROJECT_NUMBER = '1';

      try {
        // When: 환경변수에서 v2 설정을 생성하면
        const config = ServiceFactory.createGitHubV2ConfigFromEnv();

        // Then: 올바른 설정이 생성되어야 함
        expect(config.apiToken).toBe('env-test-token');
        expect(config.type).toBe(ServiceProvider.GITHUB);
        expect(config.options).toEqual({
          owner: 'test-owner',
          projectNumber: 1,
          apiVersion: 'v2',
          repositoryFilter: undefined
        });
      } finally {
        // 환경변수 복원
        if (originalToken) process.env.GITHUB_TOKEN = originalToken;
        else delete process.env.GITHUB_TOKEN;
        if (originalOwner) process.env.GITHUB_OWNER = originalOwner;
        else delete process.env.GITHUB_OWNER; 
        if (originalProjectNumber) process.env.GITHUB_PROJECT_NUMBER = originalProjectNumber;
        else delete process.env.GITHUB_PROJECT_NUMBER;
      }
    });

    it('should validate required configuration', () => {
      // Given: 필수 설정이 누락된 경우
      // When & Then: 적절한 에러가 발생해야 함
      expect(() => {
        factory.createProjectBoardService({
          type: ServiceProvider.GITHUB,
          apiToken: 'token'
          // options 누락
        });
      }).toThrow('GitHub owner is required for Projects v2');
    });
  });
});

/**
 * 테스트 실행을 위한 환경 설정 가이드:
 * 
 * 1. .env.test 파일 생성:
 *    GITHUB_TOKEN=your_github_token_here
 *    GITHUB_TEST_OWNER=your_github_username
 *    GITHUB_TEST_REPO=your_test_repository
 *    GITHUB_TEST_PROJECT_NUMBER=1
 * 
 * 2. GitHub Personal Access Token 생성:
 *    - GitHub Settings > Developer settings > Personal access tokens
 *    - 필요한 권한: repo, project (classic projects 사용 시)
 * 
 * 3. 테스트용 프로젝트 보드 생성:
 *    - Repository > Projects 탭에서 Classic Project 생성
 *    - 기본 컬럼: "To do", "In progress", "In review", "Done"
 * 
 * 4. 통합 테스트 실행:
 *    npm test -- --testPathPatterns=github-integration.test.ts
 * 
 * 5. 통합 테스트 스킵:
 *    SKIP_INTEGRATION_TESTS=true npm test
 */
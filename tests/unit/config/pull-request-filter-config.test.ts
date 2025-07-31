import { AppConfigLoader, AppEnvironment, PullRequestFilterConfig } from '../../../src/config/app-config';
import { DEFAULT_ALLOWED_BOTS } from '../../../src/types/pull-request.types';

describe('PullRequestFilterConfig', () => {
  const baseEnv: AppEnvironment = {
    NODE_ENV: 'test',
    GITHUB_TOKEN: 'test-token',
    GITHUB_OWNER: 'test-owner',
    GITHUB_REPO: 'test-repo',
    GITHUB_PROJECT_NUMBER: '123'
  };

  describe('buildPullRequestFilter', () => {
    it('should use default values when no environment variables are set', () => {
      const config = AppConfigLoader.loadFromEnvironment(baseEnv);
      
      expect(config.pullRequestFilter.allowedBots).toEqual(DEFAULT_ALLOWED_BOTS);
      expect(config.pullRequestFilter.excludeAuthor).toBe(true);
    });

    it('should parse ALLOWED_PR_BOTS from environment variable', () => {
      const env: AppEnvironment = {
        ...baseEnv,
        ALLOWED_PR_BOTS: 'sonarcloud[bot],custom-bot[bot],another-bot'
      };

      const config = AppConfigLoader.loadFromEnvironment(env);
      
      expect(config.pullRequestFilter.allowedBots).toEqual([
        'sonarcloud[bot]',
        'custom-bot[bot]',
        'another-bot'
      ]);
    });

    it('should handle ALLOWED_PR_BOTS with spaces and empty entries', () => {
      const env: AppEnvironment = {
        ...baseEnv,
        ALLOWED_PR_BOTS: ' sonarcloud[bot] , , custom-bot[bot] ,  '
      };

      const config = AppConfigLoader.loadFromEnvironment(env);
      
      expect(config.pullRequestFilter.allowedBots).toEqual([
        'sonarcloud[bot]',
        'custom-bot[bot]'
      ]);
    });

    it('should use default when ALLOWED_PR_BOTS is empty', () => {
      const env: AppEnvironment = {
        ...baseEnv,
        ALLOWED_PR_BOTS: '   ,  ,  '
      };

      const config = AppConfigLoader.loadFromEnvironment(env);
      
      expect(config.pullRequestFilter.allowedBots).toEqual(DEFAULT_ALLOWED_BOTS);
    });

    it('should set excludeAuthor to false when EXCLUDE_PR_AUTHOR is "false"', () => {
      const env: AppEnvironment = {
        ...baseEnv,
        EXCLUDE_PR_AUTHOR: 'false'
      };

      const config = AppConfigLoader.loadFromEnvironment(env);
      
      expect(config.pullRequestFilter.excludeAuthor).toBe(false);
    });

    it('should set excludeAuthor to true for any value other than "false"', () => {
      const testValues = ['true', '1', 'yes', 'TRUE', ''];
      
      testValues.forEach(value => {
        const env: AppEnvironment = {
          ...baseEnv,
          EXCLUDE_PR_AUTHOR: value
        };

        const config = AppConfigLoader.loadFromEnvironment(env);
        
        expect(config.pullRequestFilter.excludeAuthor).toBe(true);
      });

      // undefined 케이스 별도 테스트
      const envWithUndefined: AppEnvironment = {
        ...baseEnv
        // EXCLUDE_PR_AUTHOR: undefined (생략)
      };

      const configWithUndefined = AppConfigLoader.loadFromEnvironment(envWithUndefined);
      expect(configWithUndefined.pullRequestFilter.excludeAuthor).toBe(true);
    });

    it('should combine both environment variables correctly', () => {
      const env: AppEnvironment = {
        ...baseEnv,
        ALLOWED_PR_BOTS: 'bot1[bot],bot2[bot]',
        EXCLUDE_PR_AUTHOR: 'false'
      };

      const config = AppConfigLoader.loadFromEnvironment(env);
      
      expect(config.pullRequestFilter.allowedBots).toEqual(['bot1[bot]', 'bot2[bot]']);
      expect(config.pullRequestFilter.excludeAuthor).toBe(false);
    });
  });

  describe('mergeWithDefaults', () => {
    it('should merge pullRequestFilter settings from partial config', () => {
      const partialConfig = {
        pullRequestFilter: {
          allowedBots: ['custom[bot]'],
          excludeAuthor: false
        }
      };

      // AppConfigLoader의 private 메서드를 테스트하기 위해 public 메서드를 통해 간접 테스트
      const defaultConfig = AppConfigLoader.loadFromEnvironment(baseEnv);
      
      // loadFromFile을 사용하여 mergeWithDefaults 테스트
      const fs = require('fs');
      const tempConfigPath = './temp-test-config.json';
      
      try {
        fs.writeFileSync(tempConfigPath, JSON.stringify(partialConfig));
        const mergedConfig = AppConfigLoader.loadFromFile(tempConfigPath);
        
        expect(mergedConfig.pullRequestFilter.allowedBots).toEqual(['custom[bot]']);
        expect(mergedConfig.pullRequestFilter.excludeAuthor).toBe(false);
      } finally {
        // 테스트 파일 정리
        try {
          fs.unlinkSync(tempConfigPath);
        } catch (error) {
          // 파일이 없어도 무시
        }
      }
    });
  });

  describe('planner configuration integration', () => {
    it('should include pullRequestFilter in planner config', () => {
      const env: AppEnvironment = {
        ...baseEnv,
        ALLOWED_PR_BOTS: 'test-bot[bot]',
        EXCLUDE_PR_AUTHOR: 'false'
      };

      const config = AppConfigLoader.loadFromEnvironment(env);
      
      expect(config.planner.pullRequestFilter).toBeDefined();
      expect(config.planner.pullRequestFilter?.allowedBots).toEqual(['test-bot[bot]']);
      expect(config.planner.pullRequestFilter?.excludeAuthor).toBe(false);
    });
  });
});
import { 
  PlannerServiceConfig, 
  ManagerConfig, 
  SystemDeveloperConfig, 
  LoggerConfig 
} from '@/types';
import { CommentFilterOptions, DEFAULT_ALLOWED_BOTS } from '@/types/pull-request.types';

export interface PullRequestFilterConfig extends CommentFilterOptions {
  // CommentFilterOptions를 확장하여 추가 설정이 필요한 경우 여기에 추가
}

export interface AppConfig {
  readonly planner: PlannerServiceConfig;
  readonly manager: ManagerConfig;
  readonly developer: SystemDeveloperConfig;
  readonly logger: LoggerConfig;
  readonly pullRequestFilter: PullRequestFilterConfig;
  readonly nodeEnv: 'development' | 'production' | 'test';
}

export interface AppEnvironment {
  readonly NODE_ENV: string;
  readonly GITHUB_TOKEN?: string;
  readonly CLAUDE_CODE_PATH?: string;
  readonly GEMINI_CLI_PATH?: string;
  readonly LOG_LEVEL?: string;
  readonly LOG_FILE?: string;
  readonly WORKSPACE_ROOT?: string;
  readonly PROJECT_BOARD_ID?: string;
  readonly REPOSITORY_OWNER?: string;
  readonly REPOSITORY_NAME?: string;
  readonly GITHUB_PROJECT_NUMBER?: string;
  readonly GITHUB_OWNER?: string;
  readonly GITHUB_REPO?: string;
  readonly GITHUB_REPOS?: string;
  readonly GITHUB_REPO_FILTER_MODE?: string;
  readonly MONITORING_INTERVAL_MS?: string;
  readonly ALLOWED_PR_BOTS?: string;
  readonly EXCLUDE_PR_AUTHOR?: string;
}

export class AppConfigLoader {
  static loadFromEnvironment(env: AppEnvironment = process.env as any): AppConfig {
    const nodeEnv = (env.NODE_ENV || 'development') as 'development' | 'production' | 'test';
    const workspaceRoot = env.WORKSPACE_ROOT || './workspace';
    const logLevel = env.LOG_LEVEL || 'info';
    const logFile = env.LOG_FILE || './logs/app.log';

    // 레포지토리 필터 설정 처리
    const repositoryFilter = this.buildRepositoryFilter(env);
    
    // PR 코멘트 필터 설정 처리
    const pullRequestFilter = this.buildPullRequestFilter(env);

    return {
      nodeEnv,
      planner: {
        boardId: env.GITHUB_PROJECT_NUMBER ? `PVT_kwHOAJ39a84A91F1` : 'default-board', // GitHub Project ID
        repoId: `${env.GITHUB_OWNER || env.REPOSITORY_OWNER || 'example'}/${env.GITHUB_REPO || env.REPOSITORY_NAME || 'repo'}`,
        monitoringIntervalMs: env.MONITORING_INTERVAL_MS 
          ? parseInt(env.MONITORING_INTERVAL_MS, 10) 
          : (nodeEnv === 'development' ? 15000 : 30000), // 15초 vs 30초
        maxRetryAttempts: 3,
        timeoutMs: 60000,
        repositoryFilter,
        pullRequestFilter
      },
      manager: {
        workspaceRoot,
        workerPool: {
          minWorkers: nodeEnv === 'development' ? 1 : 2,
          maxWorkers: nodeEnv === 'development' ? 2 : 5,
          workerTimeoutMs: 300000 // 5분
        },
        gitOperationTimeoutMs: 60000, // 1분
        repositoryCacheTimeoutMs: 300000, // 5분
        gitConfig: {
          cloneDepth: 1,
          enableConcurrencyLock: true
        },
        pullRequest: {
          provider: 'github' as any,
          config: {
            type: 'github' as any,
            apiToken: env.GITHUB_TOKEN || '',
            baseUrl: 'https://api.github.com'
          }
        }
      },
      developer: {
        claudeCodePath: env.CLAUDE_CODE_PATH || 'claude',
        claudeCodeTimeoutMs: 300000, // 5분
        geminiCliPath: env.GEMINI_CLI_PATH || 'gemini',
        geminiCliTimeoutMs: 300000 // 5분
      },
      logger: {
        level: logLevel as any,
        filePath: logFile,
        enableConsole: nodeEnv === 'development'
      },
      pullRequestFilter
    };
  }

  static loadFromFile(configPath: string): AppConfig {
    try {
      const fs = require('fs');
      const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return this.mergeWithDefaults(configData);
    } catch (error) {
      console.warn(`Could not load config from ${configPath}, using environment defaults`);
      return this.loadFromEnvironment();
    }
  }

  private static mergeWithDefaults(partialConfig: Partial<AppConfig>): AppConfig {
    const defaultConfig = this.loadFromEnvironment();
    
    return {
      nodeEnv: partialConfig.nodeEnv || defaultConfig.nodeEnv,
      planner: { ...defaultConfig.planner, ...partialConfig.planner },
      manager: { ...defaultConfig.manager, ...partialConfig.manager },
      developer: { ...defaultConfig.developer, ...partialConfig.developer },
      logger: { ...defaultConfig.logger, ...partialConfig.logger },
      pullRequestFilter: { ...defaultConfig.pullRequestFilter, ...partialConfig.pullRequestFilter }
    };
  }

  private static buildRepositoryFilter(env: AppEnvironment): any {
    // GITHUB_REPOS가 설정된 경우 (새로운 방식)
    if (env.GITHUB_REPOS) {
      const repos = env.GITHUB_REPOS.split(',').map(repo => repo.trim()).filter(repo => repo.length > 0);
      const mode = (env.GITHUB_REPO_FILTER_MODE || 'whitelist') as 'whitelist' | 'blacklist';
      
      return {
        allowedRepositories: repos,
        mode
      };
    }
    
    // GITHUB_REPO가 설정된 경우 (기존 방식)
    if (env.GITHUB_REPO && env.GITHUB_OWNER) {
      return {
        allowedRepositories: [`${env.GITHUB_OWNER}/${env.GITHUB_REPO}`],
        mode: 'whitelist' as const
      };
    }
    
    // 둘 다 없는 경우 필터 사용 안 함
    return undefined;
  }

  private static buildPullRequestFilter(env: AppEnvironment): PullRequestFilterConfig {
    // 허용된 Bot 목록 파싱
    let allowedBots = DEFAULT_ALLOWED_BOTS;
    if (env.ALLOWED_PR_BOTS) {
      const parsed = env.ALLOWED_PR_BOTS
        .split(',')
        .map(bot => bot.trim())
        .filter(bot => bot.length > 0);
      
      if (parsed.length > 0) {
        allowedBots = parsed;
      }
    }

    // PR 생성자 제외 설정
    const excludeAuthor = env.EXCLUDE_PR_AUTHOR !== 'false'; // 기본값: true

    return {
      allowedBots,
      excludeAuthor
    };
  }

  static validate(config: AppConfig): void {
    const errors: string[] = [];

    if (!config.planner.boardId) {
      errors.push('planner.boardId is required');
    }

    if (!config.planner.repoId) {
      errors.push('planner.repoId is required');
    }

    if (!config.manager.workspaceRoot) {
      errors.push('manager.workspaceRoot is required');
    }

    if (config.manager.workerPool.minWorkers < 1) {
      errors.push('manager.workerPool.minWorkers must be at least 1');
    }

    if (config.manager.workerPool.maxWorkers < config.manager.workerPool.minWorkers) {
      errors.push('manager.workerPool.maxWorkers must be >= minWorkers');
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }
}
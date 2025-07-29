import { 
  PlannerServiceConfig, 
  ManagerConfig, 
  SystemDeveloperConfig, 
  LoggerConfig 
} from '@/types';

export interface AppConfig {
  readonly planner: PlannerServiceConfig;
  readonly manager: ManagerConfig;
  readonly developer: SystemDeveloperConfig;
  readonly logger: LoggerConfig;
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
}

export class AppConfigLoader {
  static loadFromEnvironment(env: AppEnvironment = process.env as any): AppConfig {
    const nodeEnv = (env.NODE_ENV || 'development') as 'development' | 'production' | 'test';
    const workspaceRoot = env.WORKSPACE_ROOT || './workspace';
    const logLevel = env.LOG_LEVEL || 'info';
    const logFile = env.LOG_FILE || './logs/app.log';

    // 레포지토리 필터 설정 처리
    const repositoryFilter = this.buildRepositoryFilter(env);

    return {
      nodeEnv,
      planner: {
        boardId: env.GITHUB_PROJECT_NUMBER ? `PVT_kwHOAJ39a84A91F1` : 'default-board', // GitHub Project ID
        repoId: `${env.GITHUB_OWNER || env.REPOSITORY_OWNER || 'example'}/${env.GITHUB_REPO || env.REPOSITORY_NAME || 'repo'}`,
        monitoringIntervalMs: nodeEnv === 'development' ? 15000 : 30000, // 15초 vs 30초
        maxRetryAttempts: 3,
        timeoutMs: 60000,
        repositoryFilter
      },
      manager: {
        workspaceRoot,
        workerPool: {
          minWorkers: nodeEnv === 'development' ? 1 : 2,
          maxWorkers: nodeEnv === 'development' ? 2 : 5,
          workerTimeoutMs: 300000 // 5분
        },
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
      }
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
      logger: { ...defaultConfig.logger, ...partialConfig.logger }
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
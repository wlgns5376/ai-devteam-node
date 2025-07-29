import { ServiceProvider, ProviderConfig } from './provider.types';

export { ServiceProvider } from './provider.types';

export interface RepositoryFilterConfig {
  readonly allowedRepositories?: string[];
  readonly mode: 'whitelist' | 'blacklist';
}

export interface PlannerConfig {
  readonly pollingIntervalMs: number;
  readonly projectBoard: {
    readonly provider: ServiceProvider;
    readonly boardId: string;
    readonly config: ProviderConfig;
    readonly repositoryFilter?: RepositoryFilterConfig;
  };
  readonly repository: {
    readonly provider: ServiceProvider;
    readonly owner: string;
    readonly name: string;
    readonly config: ProviderConfig;
  };
}

export interface ManagerConfig {
  readonly workspaceRoot: string;
  readonly workerPool: {
    readonly minWorkers: number;
    readonly maxWorkers: number;
    readonly workerTimeoutMs: number;
  };
  readonly gitConfig: {
    readonly cloneDepth: number;
    readonly enableConcurrencyLock: boolean;
  };
  readonly pullRequest: {
    readonly provider: ServiceProvider;
    readonly config: ProviderConfig;
  };
}

export interface SystemDeveloperConfig {
  readonly claudeCodePath: string;
  readonly claudeCodeTimeoutMs: number;
  readonly geminiCliPath: string;
  readonly geminiCliTimeoutMs: number;
}

export interface LoggerConfig {
  readonly level: 'error' | 'warn' | 'info' | 'debug';
  readonly filePath: string;
  readonly enableConsole: boolean;
}

export interface SystemConfig {
  readonly planner: PlannerConfig;
  readonly manager: ManagerConfig;
  readonly developer: SystemDeveloperConfig;
  readonly logger: LoggerConfig;
  readonly nodeEnv: 'development' | 'production' | 'test';
}
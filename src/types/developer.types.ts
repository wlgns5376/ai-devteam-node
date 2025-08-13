export interface DeveloperInterface {
  readonly type: DeveloperType;
  
  initialize(): Promise<void>;
  executePrompt(prompt: string, workspaceDir: string): Promise<DeveloperOutput>;
  cleanup(): Promise<void>;
  isAvailable(): Promise<boolean>;
  setTimeout(timeoutMs: number): void;
}

export type DeveloperType = 'claude' | 'gemini' | 'mock';

export interface DeveloperOutput {
  rawOutput: string;
  result: DeveloperResult;
  executedCommands: Command[];
  modifiedFiles: string[];
  metadata: DeveloperMetadata;
}

export interface DeveloperResult {
  success: boolean;
  prLink?: string;
  commitHash?: string;
  error?: string;
}

export interface Command {
  command: string;
  output: string;
  exitCode: number;
  timestamp: Date;
}

export interface DeveloperMetadata {
  startTime: Date;
  endTime: Date;
  duration: number;
  developerType: DeveloperType;
}

export interface DeveloperConfig {
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  
  // CLI 실행 파일 경로
  claudeCodePath?: string;
  geminiCliPath?: string;
  
  claude?: ClaudeConfig;
  gemini?: GeminiConfig;
  mock?: MockConfig;
}

export interface ClaudeConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GeminiConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface MockConfig {
  responseDelay?: number;
  scenarioPath?: string;
  defaultScenario?: MockScenario;
}

export enum MockScenario {
  SUCCESS_WITH_PR = 'success_with_pr',
  SUCCESS_CODE_ONLY = 'success_code_only',
  ERROR = 'error',
  TIMEOUT = 'timeout',
  EXECUTION_FAILURE = 'execution_failure',
  INVALID_RESPONSE = 'invalid_response',
  PROCESS_CRASH = 'process_crash',
  NETWORK_ERROR = 'network_error',
  RESOURCE_EXHAUSTION = 'resource_exhaustion'
}

export class DeveloperError extends Error {
  constructor(
    message: string,
    public readonly code: DeveloperErrorCode,
    public readonly developerType: DeveloperType,
    public readonly context?: any
  ) {
    super(message);
    this.name = 'DeveloperError';
  }
}

export enum DeveloperErrorCode {
  INITIALIZATION_FAILED = 'DEVELOPER_INIT_FAILED',
  EXECUTION_FAILED = 'DEVELOPER_EXEC_FAILED',
  TIMEOUT = 'DEVELOPER_TIMEOUT',
  PARSE_ERROR = 'DEVELOPER_PARSE_ERROR',
  PROCESS_CRASHED = 'DEVELOPER_PROCESS_CRASHED',
  NOT_AVAILABLE = 'DEVELOPER_NOT_AVAILABLE'
}

export interface DeveloperDependencies {
  logger: {
    info(message: string, context?: any): void;
    debug(message: string, context?: any): void;
    error(message: string, context?: any): void;
    warn(message: string, context?: any): void;
  };
}
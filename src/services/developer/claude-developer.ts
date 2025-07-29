import {
  DeveloperInterface,
  DeveloperOutput,
  DeveloperConfig,
  DeveloperDependencies,
  DeveloperType,
  DeveloperError,
  DeveloperErrorCode
} from '@/types/developer.types';
import { ResponseParser } from './response-parser';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ClaudeDeveloper implements DeveloperInterface {
  readonly type: DeveloperType = 'claude';
  private isInitialized = false;
  private timeoutMs: number;
  private responseParser: ResponseParser;

  constructor(
    private readonly config: DeveloperConfig,
    private readonly dependencies: DeveloperDependencies
  ) {
    this.timeoutMs = config.timeoutMs;
    this.responseParser = new ResponseParser();
  }

  async initialize(): Promise<void> {
    try {
      // Claude CLI 설치 확인
      await this.checkClaudeCLI();
      
      this.isInitialized = true;
      
      if (this.config.claude?.apiKey) {
        this.dependencies.logger.info('Claude Developer initialized with API key');
      } else {
        this.dependencies.logger.info('Claude Developer initialized with token authentication');
      }
    } catch (error) {
      this.dependencies.logger.error('Claude Developer initialization failed', { error });
      throw new DeveloperError(
        'Claude CLI is not installed',
        DeveloperErrorCode.INITIALIZATION_FAILED,
        'claude',
        { originalError: error }
      );
    }
  }

  async executePrompt(prompt: string, workspaceDir: string): Promise<DeveloperOutput> {
    if (!this.isInitialized) {
      throw new DeveloperError(
        'Claude Developer not initialized',
        DeveloperErrorCode.NOT_AVAILABLE,
        'claude'
      );
    }

    const startTime = new Date();

    try {
      this.dependencies.logger.debug('Executing Claude prompt', { 
        prompt: prompt.substring(0, 100) + '...', 
        workspaceDir 
      });

      // Claude CLI 명령어 구성
      const command = this.buildClaudeCommand(prompt);
      
      // 환경 변수 설정 (API 키가 있으면 설정, 없으면 로그인된 상태 사용)
      const env = {
        ...process.env
      };
      
      if (this.config.claude?.apiKey) {
        env.ANTHROPIC_API_KEY = this.config.claude.apiKey;
      }

      // Claude CLI 실행
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspaceDir,
        timeout: this.timeoutMs,
        env
      });

      const rawOutput = stdout.trim();
      
      this.dependencies.logger.debug('Claude execution completed', { 
        outputLength: rawOutput.length,
        hasError: !!stderr 
      });

      // 응답 파싱
      const parsedOutput = this.responseParser.parseOutput(rawOutput);
      
      const endTime = new Date();
      const result: any = {
        success: parsedOutput.success
      };
      
      if (parsedOutput.prLink) {
        result.prLink = parsedOutput.prLink;
      }
      
      if (parsedOutput.commitHash) {
        result.commitHash = parsedOutput.commitHash;
      }
      
      if (stderr) {
        result.error = stderr;
      }

      const output: DeveloperOutput = {
        rawOutput,
        result,
        executedCommands: parsedOutput.commands,
        modifiedFiles: parsedOutput.modifiedFiles,
        metadata: {
          startTime,
          endTime,
          duration: endTime.getTime() - startTime.getTime(),
          developerType: 'claude'
        }
      };

      if (!parsedOutput.success && stderr) {
        this.dependencies.logger.warn('Claude execution completed with warnings', { stderr });
      }

      return output;
      
    } catch (error) {
      this.dependencies.logger.error('Claude Developer execution failed', { 
        error, 
        prompt: prompt.substring(0, 100) + '...',
        workspaceDir 
      });

      // 타임아웃 에러 처리
      if (error instanceof Error && error.message.includes('timeout')) {
        throw new DeveloperError(
          'Claude Developer execution timeout',
          DeveloperErrorCode.TIMEOUT,
          'claude',
          { originalError: error, timeoutMs: this.timeoutMs }
        );
      }

      // 일반적인 실행 에러
      throw new DeveloperError(
        'Claude Developer execution failed',
        DeveloperErrorCode.EXECUTION_FAILED,
        'claude',
        { originalError: error, prompt, workspaceDir }
      );
    }
  }

  async cleanup(): Promise<void> {
    this.isInitialized = false;
    this.dependencies.logger.info('Claude Developer cleaned up');
  }

  async isAvailable(): Promise<boolean> {
    return this.isInitialized;
  }

  setTimeout(timeoutMs: number): void {
    this.timeoutMs = timeoutMs;
    this.dependencies.logger.debug('Claude Developer timeout set', { timeoutMs });
  }

  private async checkClaudeCLI(): Promise<void> {
    try {
      // claude --version 또는 claude --help 명령어로 설치 확인
      await execAsync('claude --version', { timeout: 5000 });
    } catch (error) {
      // claude --version이 실패하면 claude --help 시도
      try {
        await execAsync('claude --help', { timeout: 5000 });
      } catch (helpError) {
        throw new Error('Claude CLI not found. Please install Claude CLI first.');
      }
    }
  }


  private buildClaudeCommand(prompt: string): string {
    // 프롬프트에서 따옴표 이스케이프
    const escapedPrompt = prompt.replace(/"/g, '\\"');
    
    // claude -p "프롬프트" 형태로 명령어 구성
    return `claude -p "${escapedPrompt}"`;
  }
}
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
import { ContextFileManager, ContextFileConfig } from './context-file-manager';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export class ClaudeDeveloper implements DeveloperInterface {
  readonly type: DeveloperType = 'claude';
  private isInitialized = false;
  private timeoutMs: number;
  private responseParser: ResponseParser;
  private contextFileManager: ContextFileManager;

  constructor(
    private readonly config: DeveloperConfig,
    private readonly dependencies: DeveloperDependencies
  ) {
    this.timeoutMs = config.timeoutMs;
    this.responseParser = new ResponseParser();
    
    // Context File Manager 초기화
    const contextConfig: ContextFileConfig = {
      maxContextLength: 8000, // Claude CLI에 적합한 크기
      contextDirectory: path.join(process.cwd(), '.ai-devteam', 'context'),
      enableMarkdownImports: true
    };
    
    this.contextFileManager = new ContextFileManager(contextConfig, {
      logger: dependencies.logger
    });
  }

  async initialize(): Promise<void> {
    try {
      // Context File Manager 초기화
      await this.contextFileManager.initialize();
      
      // Claude CLI 설치 확인
      await this.checkClaudeCLI();
      
      this.isInitialized = true;
      
      if (this.config.claude?.apiKey) {
        this.dependencies.logger.info('Claude Developer initialized with API key');
      } else {
        this.dependencies.logger.info('Claude Developer initialized (will use system authentication)');
      }
    } catch (error) {
      this.dependencies.logger.error('Claude Developer initialization failed', { error });
      
      // DeveloperError는 그대로 다시 throw
      if (error instanceof DeveloperError) {
        throw error;
      }
      
      // 일반 에러는 CLI 설치 에러로 처리
      throw new DeveloperError(
        'Claude CLI is not installed or not accessible',
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
        promptLength: prompt.length,
        workspaceDir 
      });

      // 긴 컨텍스트 처리 및 최적화된 프롬프트 생성
      const optimizedPrompt = await this.processLongContext(prompt, workspaceDir);

      // Claude CLI 명령어 구성
      const command = this.buildClaudeCommand(optimizedPrompt);
      
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
    // 컨텍스트 파일 정리
    await this.contextFileManager.cleanupContextFiles();
    
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
    return `claude --dangerously-skip-permissions -p "${escapedPrompt}"`;
  }

  /**
   * 긴 컨텍스트를 파일로 분리하고 최적화된 프롬프트 생성
   */
  private async processLongContext(prompt: string, workspaceDir: string): Promise<string> {
    // 컨텍스트 길이 확인
    if (!this.contextFileManager.shouldSplitContext(prompt)) {
      return prompt;
    }

    this.dependencies.logger.debug('Processing long context', {
      originalLength: prompt.length,
      workspaceDir
    });

    try {
      // 프롬프트를 구조적으로 분석하여 컨텍스트와 지시사항 분리
      const { mainInstruction, contextContent, taskInfo } = this.parsePromptStructure(prompt);

      // 긴 컨텍스트를 파일로 분리
      const contextFiles = await this.contextFileManager.splitLongContext(
        contextContent,
        'context'
      );

      // 워크스페이스별 컨텍스트 파일 생성
      let workspaceContextPath = '';
      if (taskInfo) {
        workspaceContextPath = await this.contextFileManager.createWorkspaceContext(
          workspaceDir,
          taskInfo
        );
      }

      // 최적화된 프롬프트 생성 (파일 참조 방식)
      const optimizedPrompt = this.buildOptimizedPrompt(
        mainInstruction,
        contextFiles,
        workspaceContextPath
      );

      this.dependencies.logger.debug('Context optimization completed', {
        originalLength: prompt.length,
        optimizedLength: optimizedPrompt.length,
        contextFiles: contextFiles.length,
        hasWorkspaceContext: !!workspaceContextPath
      });

      return optimizedPrompt;

    } catch (error) {
      this.dependencies.logger.warn('Context processing failed, using original prompt', { error });
      return prompt;
    }
  }

  /**
   * 프롬프트를 구조적으로 분석하여 지시사항과 컨텍스트 분리
   */
  private parsePromptStructure(prompt: string): {
    mainInstruction: string;
    contextContent: string;
    taskInfo: {
      title: string;
      description: string;
      requirements: string[];
      constraints?: string[];
      examples?: string[];
    } | undefined;
  } {
    // 간단한 패턴 매칭으로 구조화
    const lines = prompt.split('\n');
    
    let mainInstruction = '';
    let contextContent = '';
    let currentSection = 'instruction';
    
    const requirements: string[] = [];
    const constraints: string[] = [];
    const examples: string[] = [];
    
    let title = '';
    let description = '';

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // 섹션 구분자 감지
      if (trimmedLine.match(/^(context|컨텍스트|배경|background):/i)) {
        currentSection = 'context';
        continue;
      } else if (trimmedLine.match(/^(task|작업|요구사항|requirements?):/i)) {
        currentSection = 'task';
        continue;
      } else if (trimmedLine.match(/^(제약|constraint|제한)s?:/i)) {
        currentSection = 'constraints';
        continue;
      } else if (trimmedLine.match(/^(예시|example|sample)s?:/i)) {
        currentSection = 'examples';
        continue;
      }

      // 섹션별 내용 분류
      switch (currentSection) {
        case 'instruction':
          mainInstruction += line + '\n';
          if (!title && trimmedLine.length > 0) {
            title = trimmedLine.substring(0, 100);
          }
          break;
        case 'context':
          contextContent += line + '\n';
          break;
        case 'task':
          if (trimmedLine.startsWith('- ') || trimmedLine.match(/^\d+\./)) {
            requirements.push(trimmedLine.replace(/^[-\d.]\s*/, ''));
          } else if (trimmedLine.length > 0) {
            description += trimmedLine + ' ';
          }
          break;
        case 'constraints':
          if (trimmedLine.startsWith('- ') || trimmedLine.match(/^\d+\./)) {
            constraints.push(trimmedLine.replace(/^[-\d.]\s*/, ''));
          }
          break;
        case 'examples':
          if (trimmedLine.length > 0) {
            examples.push(trimmedLine);
          }
          break;
      }
    }

    const taskInfo = title || requirements.length > 0 ? {
      title: title || 'Development Task',
      description: description.trim() || mainInstruction.substring(0, 200),
      requirements,
      ...(constraints.length > 0 && { constraints }),
      ...(examples.length > 0 && { examples })
    } : undefined;

    return {
      mainInstruction: mainInstruction.trim(),
      contextContent: contextContent.trim(),
      taskInfo
    };
  }

  /**
   * 파일 참조를 포함한 최적화된 프롬프트 생성
   */
  private buildOptimizedPrompt(
    mainInstruction: string,
    contextFiles: any[],
    workspaceContextPath?: string
  ): string {
    const sections: string[] = [];

    // 메인 지시사항
    if (mainInstruction) {
      sections.push(mainInstruction);
    }

    // 워크스페이스 컨텍스트 참조
    if (workspaceContextPath) {
      sections.push(`\n# Task Context\n${this.contextFileManager.generateFileReference(workspaceContextPath, 'Task-specific context and requirements')}`);
    }

    // 컨텍스트 파일 참조
    if (contextFiles.length > 0) {
      sections.push('\n# Additional Context');
      sections.push('Please refer to the following context files:');
      
      contextFiles.forEach((file, index) => {
        const reference = this.contextFileManager.generateFileReference(
          file.filePath,
          `Context part ${index + 1}`
        );
        sections.push(reference);
      });
    }

    // 최종 지시사항
    sections.push(`
# Instructions
- Review all referenced context files before proceeding
- Follow the task requirements specified in the context
- Ensure your response addresses all the specified requirements
- Create appropriate files and implement the requested functionality
`);

    return sections.join('\n');
  }
}
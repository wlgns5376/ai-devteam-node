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
import * as fs from 'fs/promises';
import * as os from 'os';

const execAsync = promisify(exec);

export class ClaudeDeveloper implements DeveloperInterface {
  readonly type: DeveloperType = 'claude';
  private isInitialized = false;
  private timeoutMs: number;
  private responseParser: ResponseParser;
  private contextFileManager: ContextFileManager | null = null;

  constructor(
    private readonly config: DeveloperConfig,
    private readonly dependencies: DeveloperDependencies
  ) {
    this.timeoutMs = config.timeoutMs;
    this.responseParser = new ResponseParser();
    
    // Context File Manager는 executePrompt에서 workspace별로 초기화
  }

  async initialize(): Promise<void> {
    try {
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
    let promptFilePath: string | undefined;

    try {
      this.dependencies.logger.debug('Executing Claude prompt', { 
        promptLength: prompt.length,
        workspaceDir 
      });

      // workspace별 Context File Manager 초기화
      await this.initializeContextFileManager(workspaceDir);

      // 긴 컨텍스트 처리 및 최적화된 프롬프트 생성
      const optimizedPrompt = await this.processLongContext(prompt, workspaceDir);

      // 프롬프트를 tmp 파일로 저장
      promptFilePath = await this.createPromptFile(optimizedPrompt);

      // Claude CLI 명령어 구성
      const command = this.buildClaudeCommand(promptFilePath);
      
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
        env,
        shell: '/bin/bash' // shell 명시적 사용으로 파이프 처리 안정화
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

      // tmp 파일 정리
      if (promptFilePath) {
        await this.cleanupPromptFile(promptFilePath);
      }

      return output;
      
    } catch (error) {
      // 에러 발생 시에도 tmp 파일 정리
      if (promptFilePath) {
        await this.cleanupPromptFile(promptFilePath);
      }
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
    // 컨텍스트 파일 정리 (contextFileManager가 초기화된 경우에만)
    if (this.contextFileManager) {
      await this.contextFileManager.cleanupContextFiles();
    }
    
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

  /**
   * workspace별 Context File Manager 초기화
   */
  private async initializeContextFileManager(workspaceDir: string): Promise<void> {
    const contextConfig: ContextFileConfig = {
      maxContextLength: 8000, // Claude CLI에 적합한 크기
      contextDirectory: path.join(workspaceDir, '.ai-devteam', 'context'),
      enableMarkdownImports: true
    };
    
    this.contextFileManager = new ContextFileManager(contextConfig, {
      logger: this.dependencies.logger
    });
    
    await this.contextFileManager.initialize();
    
    this.dependencies.logger.debug('Context File Manager initialized for workspace', {
      workspaceDir,
      contextDirectory: contextConfig.contextDirectory
    });
  }

  private async checkClaudeCLI(): Promise<void> {
    const claudePath = this.config.claudeCodePath || 'claude';
    
    try {
      // 설정된 경로로 직접 실행 테스트 (--help로 실제 실행 가능성 확인)
      const result = await execAsync(`"${claudePath}" --help`, { timeout: 3000 });
      if (!result.stdout && !result.stderr) {
        throw new Error('Claude CLI not responding properly');
      }
    } catch (helpError) {
      // 직접 실행이 실패하면 which로 PATH에서 찾기
      try {
        await execAsync(`which "${claudePath}"`, { timeout: 2000 });
      } catch (whichError) {
        throw new Error(`Claude CLI not found at path: ${claudePath}. Please check CLAUDE_CODE_PATH setting or install Claude CLI.`);
      }
    }
  }


  private buildClaudeCommand(promptFilePath: string): string {
    const claudePath = this.config.claudeCodePath || 'claude';
    // shell을 명시적으로 사용하여 파이프 처리를 안전하게 함
    return `bash -c 'cat "${promptFilePath}" | "${claudePath}" --dangerously-skip-permissions -p'`;
  }

  /**
   * 긴 컨텍스트를 파일로 분리하고 최적화된 프롬프트 생성
   */
  private async processLongContext(prompt: string, workspaceDir: string): Promise<string> {
    // ContextFileManager가 초기화되지 않은 경우 원본 프롬프트 반환
    if (!this.contextFileManager) {
      return prompt;
    }

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
      if (taskInfo && this.contextFileManager) {
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
    if (workspaceContextPath && this.contextFileManager) {
      sections.push(`\n# Task Context\n${this.contextFileManager.generateFileReference(workspaceContextPath, 'Task-specific context and requirements')}`);
    }

    // 컨텍스트 파일 참조
    if (contextFiles.length > 0 && this.contextFileManager) {
      sections.push('\n# Additional Context');
      sections.push('Please refer to the following context files:');
      
      contextFiles.forEach((file, index) => {
        const reference = this.contextFileManager!.generateFileReference(
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

  /**
   * 프롬프트를 임시 파일로 저장
   */
  private async createPromptFile(prompt: string): Promise<string> {
    try {
      const tmpDir = os.tmpdir();
      const timestamp = Date.now();
      const filename = `claude-prompt-${timestamp}-${Math.random().toString(36).substring(2, 11)}.txt`;
      const filePath = path.join(tmpDir, filename);

      await fs.writeFile(filePath, prompt, 'utf-8');

      this.dependencies.logger.debug('Prompt file created', { 
        filePath, 
        promptLength: prompt.length 
      });

      return filePath;
    } catch (error) {
      this.dependencies.logger.error('Failed to create prompt file', { error });
      throw new DeveloperError(
        'Failed to create temporary prompt file',
        DeveloperErrorCode.EXECUTION_FAILED,
        'claude',
        { originalError: error }
      );
    }
  }

  /**
   * 임시 프롬프트 파일 정리
   */
  private async cleanupPromptFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
      this.dependencies.logger.debug('Prompt file cleaned up', { filePath });
    } catch (error) {
      // 파일 삭제 실패는 로그만 남기고 에러를 던지지 않음
      this.dependencies.logger.warn('Failed to cleanup prompt file', { 
        filePath, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
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
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as path from 'path';

/**
 * Claude Developer SDK 기반 구현
 * Anthropic Agent SDK를 활용하여 코드 복잡도를 대폭 감소
 */
export class ClaudeDeveloperSDK implements DeveloperInterface {
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
  }

  async initialize(): Promise<void> {
    try {
      // API 키 검증
      if (!this.config.claude?.apiKey) {
        throw new DeveloperError(
          'Claude API key is required for SDK mode',
          DeveloperErrorCode.INITIALIZATION_FAILED,
          'claude'
        );
      }

      this.isInitialized = true;
      this.dependencies.logger.info('Claude Developer SDK initialized with API key');
    } catch (error) {
      this.dependencies.logger.error('Claude Developer SDK initialization failed', { error });

      if (error instanceof DeveloperError) {
        throw error;
      }

      throw new DeveloperError(
        'Claude Developer SDK initialization failed',
        DeveloperErrorCode.INITIALIZATION_FAILED,
        'claude',
        { originalError: error }
      );
    }
  }

  async executePrompt(prompt: string, workspaceDir: string): Promise<DeveloperOutput> {
    if (!this.isInitialized) {
      throw new DeveloperError(
        'Claude Developer SDK not initialized',
        DeveloperErrorCode.NOT_AVAILABLE,
        'claude'
      );
    }

    const startTime = new Date();

    try {
      this.dependencies.logger.debug('Executing Claude prompt via SDK', {
        promptLength: prompt.length,
        workspaceDir
      });

      // workspace별 Context File Manager 초기화
      await this.initializeContextFileManager(workspaceDir);

      // 긴 컨텍스트 처리 및 최적화된 프롬프트 생성
      const optimizedPrompt = await this.processLongContext(prompt, workspaceDir);

      // SDK를 통한 실행
      const rawOutput = await this.executeWithSDK(optimizedPrompt, workspaceDir);

      this.dependencies.logger.debug('Claude SDK execution completed', {
        outputLength: rawOutput.length
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

      return output;

    } catch (error) {
      this.dependencies.logger.error('Claude Developer SDK execution failed', {
        error,
        prompt: prompt.substring(0, 100) + '...',
        workspaceDir
      });

      // 타임아웃 에러 처리
      if (error instanceof Error && error.message.includes('timeout')) {
        throw new DeveloperError(
          'Claude SDK execution timeout',
          DeveloperErrorCode.TIMEOUT,
          'claude',
          { originalError: error, timeoutMs: this.timeoutMs }
        );
      }

      // 일반적인 실행 에러
      throw new DeveloperError(
        'Claude Developer SDK execution failed',
        DeveloperErrorCode.EXECUTION_FAILED,
        'claude',
        { originalError: error, prompt, workspaceDir }
      );
    }
  }

  async cleanup(): Promise<void> {
    this.dependencies.logger.info('Starting Claude Developer SDK cleanup');

    try {
      // 컨텍스트 파일 정리
      if (this.contextFileManager) {
        try {
          await this.contextFileManager.cleanupContextFiles();
          this.dependencies.logger.debug('Context files cleaned up');
        } catch (contextError) {
          this.dependencies.logger.warn('Failed to cleanup context files', { error: contextError });
        }
      }

      this.isInitialized = false;
      this.dependencies.logger.info('Claude Developer SDK cleanup completed successfully');
    } catch (error) {
      this.dependencies.logger.error('Claude Developer SDK cleanup failed', { error });
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.isInitialized;
  }

  setTimeout(timeoutMs: number): void {
    this.timeoutMs = timeoutMs;
    this.dependencies.logger.debug('Claude Developer SDK timeout set', { timeoutMs });
  }

  /**
   * Anthropic Agent SDK를 사용하여 프롬프트 실행
   */
  private async executeWithSDK(prompt: string, workspaceDir: string): Promise<string> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Claude SDK execution timeout'));
      }, this.timeoutMs);
    });

    const executionPromise = (async () => {
      // SDK 설정
      const options: any = {
        cwd: workspaceDir,
        model: this.config.claude?.model || 'claude-sonnet-4-5-20250929',
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
      };

      this.dependencies.logger.debug('Querying Claude SDK', {
        model: options.model,
        workspaceDir: options.cwd
      });

      // SDK 스트리밍 실행
      const stream = query({
        prompt,
        options
      });

      let response = '';
      let hasResult = false;

      for await (const message of stream) {
        // Assistant 메시지에서 텍스트 추출
        if (message.type === 'assistant') {
          const content = message.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') {
                response += block.text;
              }
            }
          }
        }
        // 결과 메시지 처리
        else if (message.type === 'result') {
          hasResult = true;
          if (message.is_error) {
            throw new Error(`SDK execution error: ${message.subtype}`);
          }
          if ('result' in message) {
            response += message.result;
          }
        }
      }

      return response;
    })();

    return Promise.race([executionPromise, timeoutPromise]);
  }

  /**
   * workspace별 Context File Manager 초기화
   */
  private async initializeContextFileManager(workspaceDir: string): Promise<void> {
    const contextConfig: ContextFileConfig = {
      maxContextLength: 8000,
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

  /**
   * 긴 컨텍스트를 파일로 분리하고 최적화된 프롬프트 생성
   */
  private async processLongContext(prompt: string, workspaceDir: string): Promise<string> {
    if (!this.contextFileManager) {
      return prompt;
    }

    if (!this.contextFileManager.shouldSplitContext(prompt)) {
      return prompt;
    }

    this.dependencies.logger.debug('Processing long context', {
      originalLength: prompt.length,
      workspaceDir
    });

    try {
      const { mainInstruction, contextContent, taskInfo } = this.parsePromptStructure(prompt);

      const contextFiles = await this.contextFileManager.splitLongContext(
        contextContent,
        'context'
      );

      let workspaceContextPath = '';
      if (taskInfo && this.contextFileManager) {
        workspaceContextPath = await this.contextFileManager.createWorkspaceContext(
          workspaceDir,
          taskInfo
        );
      }

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

    if (mainInstruction) {
      sections.push(mainInstruction);
    }

    if (workspaceContextPath && this.contextFileManager) {
      sections.push(`\n# Task Context\n${this.contextFileManager.generateFileReference(workspaceContextPath, 'Task-specific context and requirements')}`);
    }

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

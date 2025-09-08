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
import { exec, spawn, ChildProcess } from 'child_process';
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
  private activeProcesses: Set<ChildProcess> = new Set();
  private readonly GRACEFUL_CLEANUP_TIMEOUT_MS = 1000;
  private readonly FORCE_KILL_TIMEOUT_MS = 5000;
  private readonly WINDOWS_ERROR_PROCESS_NOT_FOUND = 128;

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

      // Claude CLI 실행 (spawn을 사용하여 스트림 기반 처리)
      const executionResult = await this.executeClaude(command, workspaceDir, env);
      const rawOutput = executionResult.stdout.trim();
      
      this.dependencies.logger.debug('Claude execution completed', { 
        outputLength: rawOutput.length,
        hasError: !!executionResult.stderr 
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
      
      if (executionResult.stderr) {
        result.error = executionResult.stderr;
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

      if (!parsedOutput.success && executionResult.stderr) {
        this.dependencies.logger.warn('Claude execution completed with warnings', { stderr: executionResult.stderr });
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
      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('Claude execution timeout'))) {
        throw new DeveloperError(
          'Claude execution timeout',
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
    this.dependencies.logger.info('Starting Claude Developer cleanup');
    
    try {
      // 활성 프로세스 정리 (가장 중요한 작업)
      await this.cleanupActiveProcesses();
      
      // 컨텍스트 파일 정리 (contextFileManager가 초기화된 경우에만)
      if (this.contextFileManager) {
        try {
          await this.contextFileManager.cleanupContextFiles();
          this.dependencies.logger.debug('Context files cleaned up');
        } catch (contextError) {
          this.dependencies.logger.warn('Failed to cleanup context files', { error: contextError });
        }
      }
      
      this.isInitialized = false;
      this.dependencies.logger.info('Claude Developer cleanup completed successfully');
    } catch (error) {
      this.dependencies.logger.error('Claude Developer cleanup failed', { error });
      throw error;
    }
  }

  /**
   * 모든 활성 프로세스를 정리하는 메서드 (graceful shutdown용)
   */
  private async cleanupActiveProcesses(): Promise<void> {
    const processesToClean = Array.from(this.activeProcesses);
    this.activeProcesses.clear(); // 경쟁 상태 방지를 위해 즉시 clear

    this.dependencies.logger.debug('Cleaning up active Claude processes', {
      activeProcessCount: processesToClean.length
    });

    if (processesToClean.length === 0) {
      return;
    }

    const cleanupPromises = processesToClean.map(async (child) => {
      try {
        // 이미 종료된 프로세스는 즉시 건너뛰기
        if (child.exitCode !== null || child.killed) {
          this.dependencies.logger.debug('Process already exited/killed, skipping cleanup', { 
            pid: child.pid,
            exitCode: child.exitCode,
            killed: child.killed
          });
          return;
        }

        // 1단계: SIGTERM으로 정상 종료 시도
        this.dependencies.logger.debug('Sending SIGTERM to process', { pid: child.pid });
        await this.killProcessGroup(child.pid, 'SIGTERM');

        // 개별 프로세스에도 SIGTERM 전송 (이중 보장)
        if (!child.killed) {
          try {
            child.kill('SIGTERM');
          } catch (killError) {
            this.dependencies.logger.debug('Individual SIGTERM failed', {
              pid: child.pid,
              error: killError
            });
          }
        }

        // 프로세스가 종료될 때까지 최대 1초 대기
        const exitedGracefully = await new Promise<boolean>(resolve => {
          if (child.exitCode !== null || child.killed) {
            resolve(true);
            return;
          }

          const onExit = () => {
            clearTimeout(timeoutId);
            resolve(true);
          };
          
          const onClose = () => {
            clearTimeout(timeoutId);
            resolve(true);
          };

          child.once('exit', onExit);
          child.once('close', onClose);

          const timeoutId = setTimeout(() => {
            child.removeListener('exit', onExit);
            child.removeListener('close', onClose);
            resolve(false);
          }, this.GRACEFUL_CLEANUP_TIMEOUT_MS);
        });
        
        if (!exitedGracefully) {
          // 2단계: SIGKILL로 강제 종료
          this.dependencies.logger.warn('Process did not exit gracefully, sending SIGKILL', { 
            pid: child.pid 
          });
          
          await this.killProcessGroup(child.pid, 'SIGKILL');
          
          // 개별 프로세스에도 SIGKILL 전송
          if (!child.killed) {
            try {
              child.kill('SIGKILL');
            } catch (killError) {
              this.dependencies.logger.debug('Individual SIGKILL failed', {
                pid: child.pid,
                error: killError
              });
            }
          }

          // SIGKILL 후 추가 대기
          await new Promise<void>(resolve => {
            if (child.exitCode !== null || child.killed) {
              resolve();
              return;
            }

            const onExit = () => {
              clearTimeout(killTimeoutId);
              resolve();
            };
            
            const onClose = () => {
              clearTimeout(killTimeoutId);
              resolve();
            };

            child.once('exit', onExit);
            child.once('close', onClose);

            const killTimeoutId = setTimeout(() => {
              child.removeListener('exit', onExit);
              child.removeListener('close', onClose);
              this.dependencies.logger.error('Process still running after SIGKILL', {
                pid: child.pid
              });
              resolve();
            }, 2000); // SIGKILL 후 2초 대기
          });
        }

        this.dependencies.logger.debug('Process cleanup completed', { 
          pid: child.pid,
          graceful: exitedGracefully
        });

      } catch (error) {
        this.dependencies.logger.warn('Failed to cleanup process', { 
          pid: child.pid, 
          error 
        });
      }
    });

    // 모든 정리 작업 완료 대기
    await Promise.allSettled(cleanupPromises);
    
    this.dependencies.logger.info('Active processes cleanup completed', {
      processCount: processesToClean.length
    });
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

  /**
   * 프로세스 그룹을 종료하는 헬퍼 메서드 (플랫폼별 처리)
   */
  private async killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): Promise<void> {
    if (!pid) return;
    
    if (process.platform === 'win32') {
      // Windows에서는 taskkill 사용
      // SIGTERM은 정상 종료 시도(/f 없음), SIGKILL은 강제 종료(/f 포함)
      const forceFlag = signal === 'SIGKILL' ? ' /f' : '';
      try {
        await execAsync(`taskkill /pid ${pid} /t${forceFlag}`, { encoding: 'utf8', timeout: this.FORCE_KILL_TIMEOUT_MS });
        this.dependencies.logger.debug(`Terminated process tree on Windows with signal ${signal}`, { pid });
      } catch (error: unknown) {
        // 프로세스가 이미 종료된 경우는 무시하고, 그 외의 경우에만 경고를 로깅합니다.
        // execAsync가 실패할 때 'code' 속성에 종료 코드가 담김
        const isAlreadyExitedError =
          error instanceof Error && 
          'code' in error && 
          typeof (error as { code: unknown }).code === 'number' &&
          (error as { code: number }).code === this.WINDOWS_ERROR_PROCESS_NOT_FOUND;

        if (!isAlreadyExitedError) {
          this.dependencies.logger.warn('Failed to kill process tree on Windows', {
            pid,
            signal,
            error
          });
        }
      }
    } else {
      // Unix-like 시스템에서는 프로세스 그룹 사용
      try {
        process.kill(-pid, signal);
        this.dependencies.logger.debug(`Sent ${signal} to process group`, {
          pid,
          groupPid: -pid
        });
      } catch (error) {
        // ESRCH: No such process. 프로세스가 이미 종료된 경우이므로 무시합니다.
        const isNoSuchProcessError =
          error instanceof Error && 
          'code' in error && 
          (error as { code: unknown }).code === 'ESRCH';

        if (!isNoSuchProcessError) {
          this.dependencies.logger.warn('Failed to kill process group', {
            pid,
            signal,
            error
          });
        }
      }
    }
  }

  /**
   * Claude CLI를 spawn으로 실행하여 장시간 실행 지원
   */
  private async executeClaude(command: string, workspaceDir: string, env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      // bash -c 'cat "file" | "claude" --flags' 형태의 명령어를 파싱
      const bashCommand = command.replace(/^bash -c '/, '').replace(/'$/, '');
      
      this.dependencies.logger.debug('Executing Claude command', { 
        command: bashCommand,
        workspaceDir,
        timeoutMs: this.timeoutMs
      });

      // spawn으로 bash 실행
      // detached: true로 프로세스 그룹 생성 (Linux/macOS)
      const child = spawn('bash', ['-c', bashCommand], {
        cwd: workspaceDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32', // Windows가 아닌 경우 프로세스 그룹 생성
        killSignal: 'SIGTERM'
      });

      // 프로세스 추적
      this.activeProcesses.add(child);
      
      // 프로세스 종료 시 추적에서 제거 (exit과 close 이벤트 둘 다 처리)
      const cleanupProcess = () => {
        this.activeProcesses.delete(child);
        this.dependencies.logger.debug('Process removed from tracking', { pid: child.pid });
      };
      
      child.once('exit', cleanupProcess);
      child.once('close', cleanupProcess);

      let stdout = '';
      let stderr = '';
      let isResolved = false;
      let forceKillTimeout: NodeJS.Timeout | null = null;

      // 완전한 프로세스 정리를 위한 함수
      const cleanupAllProcesses = async (signal: NodeJS.Signals = 'SIGTERM') => {
        if (child.killed || child.exitCode !== null) {
          return; // 이미 종료됨
        }

        try {
          // 1. 프로세스 그룹에 시그널 전송
          await this.killProcessGroup(child.pid, signal);
          
          // 2. 개별 프로세스에도 시그널 전송 (이중 보장)
          if (child.pid && !child.killed) {
            try {
              child.kill(signal);
            } catch (killError) {
              this.dependencies.logger.debug('Individual process kill failed', {
                pid: child.pid,
                signal,
                error: killError
              });
            }
          }
          
          this.dependencies.logger.debug('Cleanup signal sent', { 
            pid: child.pid, 
            signal,
            killed: child.killed,
            exitCode: child.exitCode
          });
        } catch (error) {
          this.dependencies.logger.warn('Failed to cleanup processes', {
            pid: child.pid,
            signal,
            error
          });
        }
      };

      // 타임아웃 설정
      const timeout = setTimeout(async () => {
        if (!isResolved) {
          isResolved = true;
          this.dependencies.logger.warn('Claude execution timeout, terminating process', {
            timeoutMs: this.timeoutMs,
            pid: child.pid,
            killed: child.killed
          });
          
          // 첫 번째 시도: SIGTERM으로 정상 종료
          await cleanupAllProcesses('SIGTERM');
          
          // 5초 후에도 종료되지 않으면 SIGKILL로 강제 종료
          forceKillTimeout = setTimeout(async () => {
            if (child.exitCode === null && !child.killed) {
              this.dependencies.logger.warn('Force killing process after timeout', {
                pid: child.pid,
                timeoutMs: this.FORCE_KILL_TIMEOUT_MS
              });
              await cleanupAllProcesses('SIGKILL');
              
              // 추가적으로 2초 더 대기 후 최종 확인
              setTimeout(() => {
                if (child.exitCode === null && !child.killed) {
                  this.dependencies.logger.error('Process still running after SIGKILL', {
                    pid: child.pid
                  });
                }
              }, 2000);
            }
          }, this.FORCE_KILL_TIMEOUT_MS);
          
          reject(new Error('Claude execution timeout'));
        }
      }, this.timeoutMs);

      // stdout 데이터 수집
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      // stderr 데이터 수집
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // 프로세스 종료 처리 (exit 이벤트 - 프로세스가 종료되었을 때)
      child.on('exit', (code, signal) => {
        this.dependencies.logger.debug('Child process exited', {
          pid: child.pid,
          code,
          signal,
          isResolved
        });
      });

      // 프로세스 완전 종료 처리 (close 이벤트 - 모든 stdio 스트림이 닫혔을 때)
      child.on('close', (code, signal) => {
        clearTimeout(timeout);
        if (forceKillTimeout) {
          clearTimeout(forceKillTimeout);
        }
        
        if (!isResolved) {
          isResolved = true;
          
          this.dependencies.logger.debug('Claude process closed', {
            pid: child.pid,
            code,
            signal,
            stdoutLength: stdout.length,
            stderrLength: stderr.length
          });

          if (code === 0 || (code === null && signal === 'SIGTERM')) {
            // 정상 종료 또는 SIGTERM으로 인한 종료
            resolve({ stdout, stderr });
          } else {
            reject(new Error(`Claude process exited with code ${code}${signal ? ` (${signal})` : ''}`));
          }
        }
      });

      // 에러 처리 (spawn 실패 등)
      child.on('error', async (error) => {
        clearTimeout(timeout);
        if (forceKillTimeout) {
          clearTimeout(forceKillTimeout);
        }
        
        if (!isResolved) {
          isResolved = true;
          this.dependencies.logger.error('Claude process spawn error', { 
            pid: child.pid,
            error 
          });
          
          // 에러 발생 시에도 정리 시도
          await cleanupAllProcesses('SIGKILL');
          reject(error);
        }
      });

      // 표준 입력이 필요한 경우를 대비해 stdin 닫기
      child.stdin?.end();
    });
  }

}
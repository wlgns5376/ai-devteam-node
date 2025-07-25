import {
  DeveloperInterface,
  DeveloperOutput,
  DeveloperConfig,
  DeveloperDependencies,
  DeveloperType,
  MockScenario,
  DeveloperError,
  DeveloperErrorCode,
  Command
} from '@/types/developer.types';

export class MockDeveloper implements DeveloperInterface {
  readonly type: DeveloperType = 'mock';
  private isInitialized = false;
  private currentScenario: MockScenario;
  private timeoutMs: number;

  constructor(
    private readonly config: DeveloperConfig,
    private readonly dependencies: DeveloperDependencies
  ) {
    this.currentScenario = config.mock?.defaultScenario || MockScenario.SUCCESS_WITH_PR;
    this.timeoutMs = config.timeoutMs;
  }

  async initialize(): Promise<void> {
    this.isInitialized = true;
    this.dependencies.logger.info('Mock Developer initialized');
  }

  async executePrompt(prompt: string, workspaceDir: string): Promise<DeveloperOutput> {
    if (!this.isInitialized) {
      throw new DeveloperError(
        'Mock Developer not initialized',
        DeveloperErrorCode.NOT_AVAILABLE,
        'mock'
      );
    }

    const startTime = new Date();

    // 시나리오 자동 선택
    const scenario = this.selectScenario(prompt);

    // 응답 지연 시뮬레이션
    if (this.config.mock?.responseDelay) {
      await this.delay(this.config.mock.responseDelay);
    }

    try {
      const output = await this.generateOutput(scenario, prompt, workspaceDir);
      
      const endTime = new Date();
      output.metadata = {
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        developerType: 'mock'
      };

      return output;
    } catch (error) {
      this.dependencies.logger.error('Mock Developer execution failed', { error, scenario });
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    this.isInitialized = false;
    this.dependencies.logger.info('Mock Developer cleaned up');
  }

  async isAvailable(): Promise<boolean> {
    return this.isInitialized;
  }

  setTimeout(timeoutMs: number): void {
    this.timeoutMs = timeoutMs;
    this.dependencies.logger.debug('Mock Developer timeout set', { timeoutMs });
  }

  setScenario(scenario: MockScenario): void {
    this.currentScenario = scenario;
  }

  private selectScenario(prompt: string): MockScenario {
    const lowerPrompt = prompt.toLowerCase();

    // 프롬프트 기반 시나리오 선택
    if (lowerPrompt.includes('pr') || lowerPrompt.includes('pull request')) {
      return MockScenario.SUCCESS_WITH_PR;
    }
    
    if (lowerPrompt.includes('리팩토링') || lowerPrompt.includes('refactor')) {
      return MockScenario.SUCCESS_CODE_ONLY;
    }

    if (lowerPrompt.includes('에러') || lowerPrompt.includes('error')) {
      return MockScenario.ERROR;
    }

    if (lowerPrompt.includes('오래') || lowerPrompt.includes('long')) {
      return MockScenario.TIMEOUT;
    }

    return this.currentScenario;
  }

  private async generateOutput(
    scenario: MockScenario, 
    prompt: string, 
    workspaceDir: string
  ): Promise<DeveloperOutput> {
    switch (scenario) {
      case MockScenario.SUCCESS_WITH_PR:
        return this.generateSuccessWithPr(prompt, workspaceDir);
      
      case MockScenario.SUCCESS_CODE_ONLY:
        return this.generateSuccessCodeOnly(prompt, workspaceDir);
      
      case MockScenario.ERROR:
        throw new DeveloperError(
          'Mock execution failed',
          DeveloperErrorCode.EXECUTION_FAILED,
          'mock',
          { prompt, workspaceDir }
        );
      
      case MockScenario.TIMEOUT:
        await this.simulateTimeout();
        throw new DeveloperError(
          'Mock Developer timeout',
          DeveloperErrorCode.TIMEOUT,
          'mock'
        );
      
      default:
        throw new DeveloperError(
          `Unknown scenario: ${scenario}`,
          DeveloperErrorCode.EXECUTION_FAILED,
          'mock'
        );
    }
  }

  private generateSuccessWithPr(prompt: string, workspaceDir: string): DeveloperOutput {
    const branchName = 'feature/user-auth';
    const commitHash = this.generateCommitHash();
    const prNumber = Math.floor(Math.random() * 1000) + 1;
    const prLink = `https://github.com/user/repo/pull/${prNumber}`;

    const commands: Command[] = [
      {
        command: `git checkout -b ${branchName}`,
        output: `Switched to a new branch '${branchName}'`,
        exitCode: 0,
        timestamp: new Date()
      },
      {
        command: 'git add .',
        output: '',
        exitCode: 0,
        timestamp: new Date()
      },
      {
        command: 'git commit -m "Add user authentication"',
        output: `[${branchName} ${commitHash.substring(0, 7)}] Add user authentication\n 3 files changed, 150 insertions(+)`,
        exitCode: 0,
        timestamp: new Date()
      },
      {
        command: 'gh pr create --title "Add user authentication" --body "Implements JWT-based authentication"',
        output: prLink,
        exitCode: 0,
        timestamp: new Date()
      }
    ];

    const rawOutput = this.generateRawOutput(commands, prLink, commitHash);

    return {
      rawOutput,
      result: {
        success: true,
        prLink,
        commitHash
      },
      executedCommands: commands,
      modifiedFiles: [
        'src/auth/auth.service.ts',
        'src/auth/auth.controller.ts',
        'src/auth/auth.module.ts'
      ],
      metadata: {
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
        developerType: 'mock'
      }
    };
  }

  private generateSuccessCodeOnly(prompt: string, workspaceDir: string): DeveloperOutput {
    const commitHash = this.generateCommitHash();

    const commands: Command[] = [
      {
        command: 'git add .',
        output: '',
        exitCode: 0,
        timestamp: new Date()
      },
      {
        command: 'git commit -m "Refactor code structure"',
        output: `[main ${commitHash.substring(0, 7)}] Refactor code structure\n 5 files changed, 80 insertions(+), 120 deletions(-)`,
        exitCode: 0,
        timestamp: new Date()
      }
    ];

    const rawOutput = this.generateRawOutput(commands, undefined, commitHash);

    return {
      rawOutput,
      result: {
        success: true,
        commitHash
      },
      executedCommands: commands,
      modifiedFiles: [
        'src/services/user.service.ts',
        'src/utils/helpers.ts'
      ],
      metadata: {
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
        developerType: 'mock'
      }
    };
  }

  private generateRawOutput(commands: Command[], prLink?: string, commitHash?: string): string {
    let output = '작업을 시작합니다...\n\n';

    for (const cmd of commands) {
      output += `$ ${cmd.command}\n`;
      if (cmd.output) {
        output += `${cmd.output}\n`;
      }
      output += '\n';
    }

    if (prLink) {
      output += `PR이 생성되었습니다: ${prLink}\n`;
    }

    output += '\n작업을 완료했습니다!';

    return output;
  }

  private generateCommitHash(): string {
    const chars = '0123456789abcdef';
    let hash = '';
    for (let i = 0; i < 40; i++) {
      hash += chars[Math.floor(Math.random() * chars.length)];
    }
    return hash;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async simulateTimeout(): Promise<void> {
    // 설정된 타임아웃보다 더 오래 대기
    await this.delay(this.timeoutMs + 1000);
  }
}
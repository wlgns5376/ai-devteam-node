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
import { MockPullRequestService } from '@/services/pull-request/mock/mock-pull-request';
import { ReviewState } from '@/types';

export class MockDeveloper implements DeveloperInterface {
  readonly type: DeveloperType = 'mock';
  private isInitialized = false;
  private currentScenario: MockScenario;
  private timeoutMs: number;

  constructor(
    private readonly config: DeveloperConfig,
    private readonly dependencies: DeveloperDependencies,
    private readonly mockPullRequestService?: MockPullRequestService
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

    this.dependencies.logger.debug('Executing Mock AI prompt', { 
      promptLength: prompt.length,
      workspaceDir 
    });

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

      this.dependencies.logger.debug('Mock AI execution completed', { 
        output, 
        scenario
      });

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
    if (lowerPrompt.includes('피드백') || lowerPrompt.includes('feedback') || lowerPrompt.includes('코멘트') || lowerPrompt.includes('comment')) {
      return MockScenario.PR_FEEDBACK_APPLIED;
    }

    if (lowerPrompt.includes('merge') || lowerPrompt.includes('병합')) {
      return MockScenario.SUCCESS_CODE_ONLY; // merge는 PR 없이 코드만 성공
    }
    
    if (lowerPrompt.includes('pr') || lowerPrompt.includes('pull request')) {
      return MockScenario.SUCCESS_WITH_PR;
    }
    
    if (lowerPrompt.includes('리팩토링') || lowerPrompt.includes('refactor')) {
      return MockScenario.SUCCESS_CODE_ONLY;
    }

    if (lowerPrompt.includes('리뷰') || lowerPrompt.includes('review')) {
      return MockScenario.PR_FEEDBACK_APPLIED;
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
        return await this.generateSuccessWithPr(prompt, workspaceDir);
      
      case MockScenario.SUCCESS_CODE_ONLY:
        return this.generateSuccessCodeOnly(prompt, workspaceDir);
      
      case MockScenario.PR_FEEDBACK_APPLIED:
        return await this.generatePRFeedbackApplied(prompt, workspaceDir);
      
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
      
      case MockScenario.EXECUTION_FAILURE:
        throw new DeveloperError(
          'Developer execution failed',
          DeveloperErrorCode.EXECUTION_FAILED,
          'mock',
          { prompt, workspaceDir }
        );
      
      case MockScenario.INVALID_RESPONSE:
        return this.generateInvalidResponse(prompt, workspaceDir);
      
      case MockScenario.PROCESS_CRASH:
        // 프로세스 크래시 시뮬레이션
        await this.delay(100);
        throw new DeveloperError(
          'Developer process crashed unexpectedly',
          DeveloperErrorCode.PROCESS_CRASHED,
          'mock',
          { prompt, workspaceDir }
        );
      
      case MockScenario.NETWORK_ERROR:
        throw new DeveloperError(
          'Network error during execution',
          DeveloperErrorCode.EXECUTION_FAILED,
          'mock',
          { prompt, workspaceDir, errorType: 'NETWORK_ERROR' }
        );
      
      case MockScenario.RESOURCE_EXHAUSTION:
        throw new DeveloperError(
          'Resource exhaustion: out of memory',
          DeveloperErrorCode.EXECUTION_FAILED,
          'mock',
          { prompt, workspaceDir, errorType: 'RESOURCE_EXHAUSTION' }
        );
      
      default:
        throw new DeveloperError(
          `Unknown scenario: ${scenario}`,
          DeveloperErrorCode.EXECUTION_FAILED,
          'mock'
        );
    }
  }

  private async generateSuccessWithPr(prompt: string, workspaceDir: string): Promise<DeveloperOutput> {
    const branchName = 'feature/user-auth';
    const commitHash = this.generateCommitHash();
    const prNumber = Math.floor(Math.random() * 1000) + 1;
    const prLink = `https://github.com/test-owner/test-repo/pull/${prNumber}`;

    // MockPullRequestService에 PR 등록 (주입된 경우에만)
    if (this.mockPullRequestService) {
      await this.mockPullRequestService.setPullRequestState(prLink, ReviewState.CHANGES_REQUESTED);
    }

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
    const lowerPrompt = prompt.toLowerCase();
    
    // merge 작업인지 확인
    const isMergeOperation = lowerPrompt.includes('merge') || lowerPrompt.includes('병합');
    
    const commands: Command[] = [];
    
    if (isMergeOperation) {
      // merge 작업 시뮬레이션
      commands.push(
        {
          command: 'git checkout main',
          output: 'Switched to branch \'main\'',
          exitCode: 0,
          timestamp: new Date()
        },
        {
          command: 'git merge --no-ff feature/user-auth',
          output: `Merge made by the 'recursive' strategy.\n 3 files changed, 150 insertions(+)`,
          exitCode: 0,
          timestamp: new Date()
        },
        {
          command: 'git push origin main',
          output: 'Everything up-to-date',
          exitCode: 0,
          timestamp: new Date()
        }
      );
    } else {
      // 일반 코드 수정 작업
      commands.push(
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
      );
    }

    const rawOutput = isMergeOperation 
      ? this.generateMergeRawOutput(commands, commitHash)
      : this.generateRawOutput(commands, undefined, commitHash);

    return {
      rawOutput,
      result: {
        success: true,
        commitHash
      },
      executedCommands: commands,
      modifiedFiles: isMergeOperation 
        ? ['src/auth/auth.service.ts', 'src/auth/auth.controller.ts', 'src/auth/auth.module.ts']
        : ['src/services/user.service.ts', 'src/utils/helpers.ts'],
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
      output += `생성된 PR: ${prLink}\n`;
    }

    output += '\n작업을 완료했습니다!';

    return output;
  }

  private generateMergeRawOutput(commands: Command[], commitHash?: string): string {
    let output = '🔄 병합 작업을 시작합니다...\n\n';

    output += '📋 병합 준비 사항:\n';
    output += '  - 타겟 브랜치: main\n';
    output += '  - 소스 브랜치: feature/user-auth\n';
    output += '  - 병합 방식: --no-ff (fast-forward 없이)\n\n';

    for (const cmd of commands) {
      output += `$ ${cmd.command}\n`;
      if (cmd.output) {
        output += `${cmd.output}\n`;
      }
      output += '\n';
    }

    output += '✅ 병합이 성공적으로 완료되었습니다!\n';
    output += '📝 모든 변경사항이 메인 브랜치에 적용되었습니다.\n';
    output += '🎉 기능 브랜치의 작업이 안전하게 통합되었습니다.';

    return output;
  }

  private generateFeedbackRawOutput(commands: Command[], prLink?: string, commitHash?: string): string {
    let output = 'PR 리뷰 피드백을 반영하고 있습니다...\n\n';

    output += '📝 리뷰 코멘트 분석 완료\n';
    output += '🔧 코드 수정 중...\n\n';

    for (const cmd of commands) {
      output += `$ ${cmd.command}\n`;
      if (cmd.output) {
        output += `${cmd.output}\n`;
      }
      output += '\n';
    }

    if (prLink) {
      output += `✅ 피드백 반영 완료 - PR 업데이트됨: ${prLink}\n`;
    }

    output += '\n🎉 모든 리뷰 코멘트가 반영되었습니다!';

    return output;
  }

  private generateInvalidResponse(prompt: string, workspaceDir: string): DeveloperOutput {
    // 유효하지 않은 PR URL을 생성
    const invalidPrLink = 'not-a-valid-url';
    const commitHash = this.generateCommitHash();
    
    const commands: Command[] = [
      {
        command: 'git add .',
        output: '',
        exitCode: 0,
        timestamp: new Date()
      },
      {
        command: 'git commit -m "Test commit"',
        output: `[main ${commitHash.substring(0, 7)}] Test commit`,
        exitCode: 0,
        timestamp: new Date()
      }
    ];
    
    return {
      rawOutput: 'Invalid response simulation\n' + invalidPrLink,
      result: {
        success: true,
        prLink: invalidPrLink, // 유효하지 않은 PR URL
        commitHash
      },
      executedCommands: commands,
      modifiedFiles: ['test.ts'],
      metadata: {
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
        developerType: 'mock'
      }
    };
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

  private async generatePRFeedbackApplied(prompt: string, workspaceDir: string): Promise<DeveloperOutput> {
    const commitHash = this.generateCommitHash();
    const prNumber = Math.floor(Math.random() * 1000) + 1;
    const prLink = `https://github.com/test-owner/test-repo/pull/${prNumber}`;
    const branchName = 'feature/user-auth';

    // MockPullRequestService에 PR 상태를 approved로 변경 (주입된 경우에만)
    if (this.mockPullRequestService) {
      await this.mockPullRequestService.setPullRequestState(prLink, ReviewState.APPROVED);
    }

    const commands: Command[] = [
      {
        command: 'git add .',
        output: '',
        exitCode: 0,
        timestamp: new Date()
      },
      {
        command: 'git commit -m "Apply PR feedback: fix code review comments"',
        output: `[${branchName} ${commitHash.substring(0, 7)}] Apply PR feedback: fix code review comments\n 2 files changed, 25 insertions(+), 10 deletions(-)`,
        exitCode: 0,
        timestamp: new Date()
      },
      {
        command: `git push origin ${branchName}`,
        output: `To github.com:test-owner/test-repo.git\n   abc1234..${commitHash.substring(0, 7)}  ${branchName} -> ${branchName}`,
        exitCode: 0,
        timestamp: new Date()
      }
    ];

    const rawOutput = this.generateFeedbackRawOutput(commands, prLink, commitHash);

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
        'src/auth/auth.controller.ts'
      ],
      metadata: {
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
        developerType: 'mock'
      }
    };
  }
}
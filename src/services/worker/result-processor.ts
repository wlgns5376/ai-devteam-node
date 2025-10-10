import { 
  ResultProcessorInterface,
  WorkerTask,
  WorkerResult,
  WorkerError
} from '@/types';
import { Logger } from '../logger';

interface ResultProcessorDependencies {
  readonly logger: Logger;
}

export class ResultProcessor implements ResultProcessorInterface {
  constructor(
    private readonly dependencies: ResultProcessorDependencies
  ) {}

  async processOutput(output: string, task: WorkerTask): Promise<WorkerResult> {
    this.validateInputs(output, task);

    try {
      this.dependencies.logger.debug('Processing task output', {
        taskId: task.taskId,
        outputLength: output.length
      });

      // PR URL 추출
      const pullRequestUrl = this.extractPullRequestUrl(output);
      
      // 에러 정보 추출
      const errorInfo = this.extractErrorInfo(output);
      
      // 성공/실패 판단
      const success = errorInfo === null && this.isSuccessfulOutput(output);
      
      // 결과 세부 정보 추출
      const details = this.extractResultDetails(output, success);

      const result: WorkerResult = {
        taskId: task.taskId,
        success,
        ...(pullRequestUrl && { pullRequestUrl }),
        ...(errorInfo?.message && { errorMessage: errorInfo.message }),
        completedAt: new Date(),
        details
      };

      this.dependencies.logger.info('Task output processed successfully', {
        taskId: task.taskId,
        success
      });

      if (!success && errorInfo) {
        this.dependencies.logger.warn('Task completed with errors', {
          taskId: task.taskId,
          errorCount: 1
        });
      }

      return result;

    } catch (error) {
      const errorMessage = `Failed to process output for task ${task.taskId}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      
      this.dependencies.logger.error('Failed to process task output', {
        taskId: task.taskId,
        error
      });
      
      throw new Error(errorMessage);
    }
  }

  extractPullRequestUrl(output: string): string | null {
    // GitHub PR URL 패턴 매칭
    const prUrlPatterns = [
      /PR:\s*(https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+)/i,
      /생성된\s*PR:\s*(https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+)/i,
      /Pull\s*Request\s*링크:\s*(https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+)/i,
      /(https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+)/
    ];

    for (const pattern of prUrlPatterns) {
      const match = output.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  extractErrorInfo(output: string): WorkerError | null {
    const timestamp = new Date();

    // TypeScript 컴파일 에러 확인
    if (output.includes('TypeScript compilation failed')) {
      const errorLines = output
        .split('\n')
        .filter(line => line.includes('error TS'))
        .map(line => line.trim());

      return {
        code: 'TYPESCRIPT_ERROR',
        message: 'TypeScript compilation failed',
        timestamp,
        context: {
          errors: errorLines
        }
      };
    }

    // 테스트 실패 확인
    const testFailureMatch = output.match(/✗\s*(\d+)\s*tests?\s*failed/);
    if (testFailureMatch && testFailureMatch[1]) {
      const failedCount = parseInt(testFailureMatch[1], 10);
      const passedMatch = output.match(/✓\s*(\d+)\s*tests?\s*passed/);
      const passedCount = passedMatch && passedMatch[1] ? parseInt(passedMatch[1], 10) : 0;

      return {
        code: 'TEST_FAILURE',
        message: `${failedCount} tests failed`,
        timestamp,
        context: {
          failedTests: failedCount,
          passedTests: passedCount
        }
      };
    }

    // 일반적인 에러 확인
    const errorMatch = output.match(/Error:\s*([^\n]+)/);
    if (errorMatch && errorMatch[1]) {
      const errorDetails = output
        .split('\n')
        .find(line => line.includes('ERR!') || line.includes('ERROR'));

      return {
        code: 'EXECUTION_ERROR',
        message: errorMatch[1],
        timestamp,
        context: {
          details: errorDetails || 'No additional details'
        }
      };
    }

    return null;
  }

  async generateStatusReport(task: WorkerTask, result: WorkerResult): Promise<any> {
    const report = {
      taskId: task.taskId,
      status: result.success ? 'completed' : 'failed',
      success: result.success,
      message: result.success 
        ? '작업이 성공적으로 완료되었습니다.' 
        : '작업 처리 중 오류가 발생했습니다.',
      ...(result.pullRequestUrl && { pullRequestUrl: result.pullRequestUrl }),
      ...(result.errorMessage && { errorMessage: result.errorMessage }),
      completedAt: result.completedAt,
      summary: {
        action: task.action,
        boardItem: task.boardItem,
        ...(result.success ? { result: result.details } : { error: result.errorMessage })
      }
    };

    this.dependencies.logger.info('Status report generated', {
      taskId: task.taskId,
      success: result.success
    });

    return report;
  }

  private validateInputs(output: string, task: WorkerTask): void {
    if (typeof output !== 'string') {
      throw new Error(`Output must be a string, but received ${typeof output}`);
    }
    
    if (!output || output.trim() === '') {
      throw new Error('Output cannot be empty');
    }

    this.validateTask(task);
  }

  private validateTask(task: WorkerTask): void {
    if (!task) {
      throw new Error('Task is required');
    }
    
    if (!task.taskId || task.taskId.trim() === '') {
      throw new Error('Invalid task: taskId cannot be empty');
    }
    
    if (!task.repositoryId || task.repositoryId.trim() === '') {
      throw new Error('Invalid task: repositoryId cannot be empty');
    }
    
    if (!task.action) {
      throw new Error('Invalid task: action is required');
    }
  }

  private isSuccessfulOutput(output: string): boolean {
    // 1. 명확한 실패 지표 확인 (우선순위 높음)
    const criticalFailurePatterns = [
      /TypeScript compilation failed/i,
      /✗\s*\d+\s*tests?\s*failed/,
      /npm ERR!/,
      /Error:/,
      /FAIL(?:ED)?:/i,
      /fatal:/i,
      /Exception:/i,
      /throw new Error/i
    ];

    // 치명적 실패 패턴이 있으면 즉시 실패로 판단
    const hasCriticalFailure = criticalFailurePatterns.some(pattern =>
      pattern.test(output)
    );

    if (hasCriticalFailure) {
      return false;
    }

    // 2. 명확한 성공 지표 확인
    const strongSuccessIndicators = [
      /성공적으로\s*완료/i,
      /successfully\s*completed/i,
      /PR:\s*https:\/\/github\.com/i,
      /생성된\s*PR:\s*https:\/\/github\.com/i,
      /Pull\s*Request.*https:\/\/github\.com/i,
      /✓\s*\d+\s*tests?\s*passed/,
      /모든\s*테스트.*통과/i,
      /all\s*tests?\s*passed/i,
      /병합.*성공적으로.*완료/i,
      /merge.*successful/i,
      /Everything up-to-date/,
      /작업을.*완료했습니다/i,
      /task.*completed/i
    ];

    const hasStrongSuccessIndicator = strongSuccessIndicators.some(pattern =>
      pattern.test(output)
    );

    // 3. 약한 성공 지표 확인 (보조적)
    const weakSuccessIndicators = [
      /Coverage:/i,
      /모든\s*변경사항.*적용/i,
      /✓/,
      /커밋.*생성/i,
      /commit.*created/i
    ];

    const hasWeakSuccessIndicator = weakSuccessIndicators.some(pattern =>
      pattern.test(output)
    );

    // 4. 경미한 경고나 에러 메시지 확인 (성공에 영향 없음)
    const minorWarningPatterns = [
      /warning:/i,
      /deprecated/i,
      /WARN/i
    ];

    // 5. 최종 판단
    // - 강한 성공 지표가 있으면 성공
    // - 강한 성공 지표가 없어도 약한 성공 지표가 2개 이상 있으면 성공
    if (hasStrongSuccessIndicator) {
      return true;
    }

    // 약한 지표만 있는 경우 추가 검증
    if (hasWeakSuccessIndicator) {
      // 출력이 매우 짧으면 (50자 미만) 불확실하므로 실패로 간주
      if (output.length < 50) {
        return false;
      }

      // 경고만 있고 실제 성공 내용이 없으면 실패
      const onlyWarnings = minorWarningPatterns.some(p => p.test(output)) &&
                           !output.includes('완료') &&
                           !output.includes('completed');
      if (onlyWarnings) {
        return false;
      }

      return true;
    }

    // 성공 지표가 없으면 실패
    return false;
  }

  private extractResultDetails(output: string, success: boolean): Record<string, unknown> {
    const details: Record<string, unknown> = {};

    if (success) {
      // 요약 정보 추출
      const summaryMatch = output.match(/##\s*작업\s*진행\s*상황\s*요약[^#]*?-\s*([^\n]+)/);
      if (summaryMatch && summaryMatch[1]) {
        details.summary = summaryMatch[1].trim();
      }

      // 테스트 통과 여부
      if (output.includes('✓') && output.includes('tests passed')) {
        details.testsPassed = true;
      }

      // 커버리지 정보
      const coverageMatch = output.match(/Coverage:\s*(\d+%)/);
      if (coverageMatch) {
        details.coverage = coverageMatch[1];
      }
    }

    return details;
  }
}
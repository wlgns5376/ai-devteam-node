import { ResultProcessor } from '@/services/worker/result-processor';
import { Logger } from '@/services/logger';
import { 
  WorkerTask, 
  WorkerAction,
  WorkerResult,
  WorkerError,
  ResultProcessorInterface
} from '@/types';

describe('ResultProcessor', () => {
  let resultProcessor: ResultProcessor;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    // Given: Mock 의존성 설정
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    resultProcessor = new ResultProcessor({
      logger: mockLogger
    });
  });

  describe('출력 처리', () => {
    it('성공적인 작업 결과를 처리해야 한다', async () => {
      // Given: 성공적인 작업 출력
      const task: WorkerTask = {
        taskId: 'task-123',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        boardItem: {
          id: 'task-123',
          title: 'Implement feature'
        }
      };

      const successOutput = `작업이 성공적으로 완료되었습니다.

## 작업 진행 상황 요약
- 새로운 기능 구현 완료
- 모든 테스트 통과
- 코드 리뷰 준비 완료

## 생성된 PR 링크
PR: https://github.com/owner/repo/pull/123

## 주요 변경 사항
- src/feature.ts 파일 추가
- tests/feature.test.ts 테스트 추가
- README.md 업데이트

## 테스트 결과
✓ 15 tests passed
✓ Coverage: 85%`;

      // When: 출력 처리
      const result = await resultProcessor.processOutput(successOutput, task);

      // Then: 성공 결과 반환
      expect(result.taskId).toBe(task.taskId);
      expect(result.success).toBe(true);
      expect(result.pullRequestUrl).toBe('https://github.com/owner/repo/pull/123');
      expect(result.errorMessage).toBeUndefined();
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(result.details).toEqual({
        summary: '새로운 기능 구현 완료',
        testsPassed: true,
        coverage: '85%'
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Task output processed successfully',
        { taskId: task.taskId, success: true }
      );
    });

    it('에러가 있는 작업 결과를 처리해야 한다', async () => {
      // Given: 에러가 있는 작업 출력
      const task: WorkerTask = {
        taskId: 'task-error',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      const errorOutput = `작업 중 오류가 발생했습니다.

ERROR: TypeScript compilation failed
src/feature.ts:15:5 - error TS2322: Type 'string' is not assignable to type 'number'.

테스트 실행도 실패했습니다:
✗ 3 tests failed
✓ 12 tests passed`;

      // When: 출력 처리
      const result = await resultProcessor.processOutput(errorOutput, task);

      // Then: 실패 결과 반환
      expect(result.taskId).toBe(task.taskId);
      expect(result.success).toBe(false);
      expect(result.pullRequestUrl).toBeUndefined();
      expect(result.errorMessage).toContain('TypeScript compilation failed');
      expect(result.completedAt).toBeInstanceOf(Date);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Task completed with errors',
        { taskId: task.taskId, errorCount: 1 }
      );
    });

    it('PR 링크가 없어도 성공으로 처리해야 한다', async () => {
      // Given: PR 링크 없는 성공 출력
      const task: WorkerTask = {
        taskId: 'task-no-pr',
        action: WorkerAction.PROCESS_FEEDBACK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      const outputWithoutPR = `피드백 처리가 완료되었습니다.

## 처리한 피드백 요약
- 성능 최적화 완료
- 테스트 케이스 추가

## 테스트 결과
✓ 18 tests passed`;

      // When: 출력 처리
      const result = await resultProcessor.processOutput(outputWithoutPR, task);

      // Then: PR 없이도 성공 처리
      expect(result.success).toBe(true);
      expect(result.pullRequestUrl).toBeUndefined();
    });
  });

  describe('PR URL 추출', () => {
    it('다양한 형식의 PR URL을 추출해야 한다', () => {
      // Given: 다양한 PR URL 형식
      const testCases = [
        {
          text: 'PR: https://github.com/owner/repo/pull/123',
          expected: 'https://github.com/owner/repo/pull/123'
        },
        {
          text: '생성된 PR: https://github.com/user/project/pull/456',
          expected: 'https://github.com/user/project/pull/456'
        },
        {
          text: 'Pull Request 링크: https://github.com/org/repo/pull/789',
          expected: 'https://github.com/org/repo/pull/789'
        },
        {
          text: 'https://github.com/owner/repo/pull/999 에서 확인하세요',
          expected: 'https://github.com/owner/repo/pull/999'
        }
      ];

      testCases.forEach(({ text, expected }) => {
        // When: PR URL 추출
        const url = resultProcessor.extractPullRequestUrl(text);

        // Then: 올바른 URL 추출
        expect(url).toBe(expected);
      });
    });

    it('PR URL이 없으면 null을 반환해야 한다', () => {
      // Given: PR URL이 없는 텍스트
      const textWithoutPR = '작업이 완료되었습니다. 모든 테스트가 통과했습니다.';

      // When: PR URL 추출
      const url = resultProcessor.extractPullRequestUrl(textWithoutPR);

      // Then: null 반환
      expect(url).toBeNull();
    });

    it('잘못된 PR URL 형식은 무시해야 한다', () => {
      // Given: 잘못된 URL 형식
      const invalidUrls = [
        'PR: https://gitlab.com/owner/repo/merge_requests/123',
        'PR: not-a-url',
        'github.com/owner/repo/pull/123' // https 없음
      ];

      invalidUrls.forEach(text => {
        // When: PR URL 추출
        const url = resultProcessor.extractPullRequestUrl(text);

        // Then: null 반환
        expect(url).toBeNull();
      });
    });
  });

  describe('에러 정보 추출', () => {
    it('TypeScript 컴파일 에러를 추출해야 한다', () => {
      // Given: TypeScript 에러 출력
      const output = `ERROR: TypeScript compilation failed
src/feature.ts:15:5 - error TS2322: Type 'string' is not assignable to type 'number'.
src/utils.ts:22:10 - error TS2304: Cannot find name 'unknownVariable'.`;

      // When: 에러 정보 추출
      const error = resultProcessor.extractErrorInfo(output);

      // Then: 에러 정보 반환
      expect(error).toEqual({
        code: 'TYPESCRIPT_ERROR',
        message: 'TypeScript compilation failed',
        timestamp: expect.any(Date),
        context: {
          errors: [
            'src/feature.ts:15:5 - error TS2322: Type \'string\' is not assignable to type \'number\'.',
            'src/utils.ts:22:10 - error TS2304: Cannot find name \'unknownVariable\'.'
          ]
        }
      });
    });

    it('테스트 실패 에러를 추출해야 한다', () => {
      // Given: 테스트 실패 출력
      const output = `✗ 3 tests failed
✓ 12 tests passed

FAIL tests/feature.test.ts
  ● Feature › should work correctly
    Expected: true
    Received: false`;

      // When: 에러 정보 추출
      const error = resultProcessor.extractErrorInfo(output);

      // Then: 테스트 에러 정보 반환
      expect(error).toEqual({
        code: 'TEST_FAILURE',
        message: '3 tests failed',
        timestamp: expect.any(Date),
        context: {
          failedTests: 3,
          passedTests: 12
        }
      });
    });

    it('일반적인 에러를 추출해야 한다', () => {
      // Given: 일반 에러 출력
      const output = `Error: Package installation failed
npm ERR! code ENOTFOUND
npm ERR! errno ENOTFOUND`;

      // When: 에러 정보 추출
      const error = resultProcessor.extractErrorInfo(output);

      // Then: 일반 에러 정보 반환
      expect(error).toEqual({
        code: 'EXECUTION_ERROR',
        message: 'Package installation failed',
        timestamp: expect.any(Date),
        context: {
          details: 'npm ERR! code ENOTFOUND'
        }
      });
    });

    it('에러가 없으면 null을 반환해야 한다', () => {
      // Given: 성공적인 출력
      const successOutput = '모든 작업이 성공적으로 완료되었습니다.';

      // When: 에러 정보 추출
      const error = resultProcessor.extractErrorInfo(successOutput);

      // Then: null 반환
      expect(error).toBeNull();
    });
  });

  describe('상태 보고서 생성', () => {
    it('성공적인 작업의 상태 보고서를 생성해야 한다', async () => {
      // Given: 성공한 작업 결과
      const task: WorkerTask = {
        taskId: 'task-success',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        boardItem: {
          id: 'task-success',
          title: 'Implement authentication'
        }
      };

      const result: WorkerResult = {
        taskId: 'task-success',
        success: true,
        pullRequestUrl: 'https://github.com/owner/repo/pull/123',
        completedAt: new Date(),
        details: {
          summary: '인증 시스템 구현 완료',
          testsPassed: true,
          coverage: '90%'
        }
      };

      // When: 상태 보고서 생성
      const report = await resultProcessor.generateStatusReport(task, result);

      // Then: 완전한 보고서 생성
      expect(report).toEqual({
        taskId: task.taskId,
        status: 'completed',
        success: true,
        message: '작업이 성공적으로 완료되었습니다.',
        pullRequestUrl: result.pullRequestUrl,
        completedAt: result.completedAt,
        summary: {
          action: task.action,
          boardItem: task.boardItem,
          result: result.details
        }
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Status report generated',
        { taskId: task.taskId, success: true }
      );
    });

    it('실패한 작업의 상태 보고서를 생성해야 한다', async () => {
      // Given: 실패한 작업 결과
      const task: WorkerTask = {
        taskId: 'task-failed',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      const result: WorkerResult = {
        taskId: 'task-failed',
        success: false,
        errorMessage: 'Compilation failed',
        completedAt: new Date()
      };

      // When: 상태 보고서 생성
      const report = await resultProcessor.generateStatusReport(task, result);

      // Then: 실패 보고서 생성
      expect(report).toEqual({
        taskId: task.taskId,
        status: 'failed',
        success: false,
        message: '작업 처리 중 오류가 발생했습니다.',
        errorMessage: result.errorMessage,
        completedAt: result.completedAt,
        summary: {
          action: task.action,
          boardItem: task.boardItem,
          error: result.errorMessage
        }
      });
    });
  });

  describe('입력 검증', () => {
    it('유효하지 않은 작업에 대해 에러를 발생시켜야 한다', async () => {
      // Given: 잘못된 작업 정보
      const invalidTask = {
        taskId: '',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      } as WorkerTask;

      const output = '작업 완료';

      // When & Then: 에러 발생
      await expect(
        resultProcessor.processOutput(output, invalidTask)
      ).rejects.toThrow('Invalid task: taskId cannot be empty');
    });

    it('빈 출력에 대해 에러를 발생시켜야 한다', async () => {
      // Given: 유효한 작업과 빈 출력
      const task: WorkerTask = {
        taskId: 'task-123',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      // When & Then: 에러 발생
      await expect(
        resultProcessor.processOutput('', task)
      ).rejects.toThrow('Output cannot be empty');
    });
  });
});
import { PlannerError } from '@/types';
import { Logger } from '@/services/logger';

/**
 * Planner 에러 관리를 담당하는 클래스
 * - 에러 기록 및 관리
 * - 에러 제한 및 정리
 * - 에러 상태 조회
 */
export class PlannerErrorManager {
  private errors: PlannerError[] = [];
  private readonly maxErrorCount = 100;
  private readonly cleanupThreshold = 50;

  constructor(private readonly logger: Logger) {}

  /**
   * 새로운 에러 추가
   */
  addError(code: string, message: string, context?: Record<string, unknown>): void {
    const error: PlannerError = {
      message,
      code,
      timestamp: new Date(),
      context
    };
    
    this.errors.push(error);
    
    // 에러 개수 제한 (최대 100개, 50개로 정리)
    if (this.errors.length > this.maxErrorCount) {
      this.errors = this.errors.slice(-this.cleanupThreshold);
      this.logger.warn('Error list cleaned up due to size limit', {
        previousCount: this.maxErrorCount,
        currentCount: this.cleanupThreshold
      });
    }

    this.logger.error('Planner error recorded', {
      code,
      message,
      context
    });
  }

  /**
   * 모든 에러 목록 반환
   */
  getAllErrors(): PlannerError[] {
    return [...this.errors];
  }

  /**
   * 특정 코드의 에러 개수 반환
   */
  getErrorCount(code?: string): number {
    if (!code) {
      return this.errors.length;
    }
    return this.errors.filter(error => error.code === code).length;
  }

  /**
   * 최근 에러 반환
   */
  getRecentErrors(limit: number = 10): PlannerError[] {
    return this.errors.slice(-limit);
  }

  /**
   * 특정 시간 이후의 에러 반환
   */
  getErrorsSince(since: Date): PlannerError[] {
    return this.errors.filter(error => error.timestamp > since);
  }

  /**
   * 에러 목록 초기화
   */
  clearErrors(): void {
    const previousCount = this.errors.length;
    this.errors = [];
    
    this.logger.info('Error list cleared', {
      previousCount
    });
  }

  /**
   * 에러 통계 반환
   */
  getErrorStats(): {
    total: number;
    byCode: Record<string, number>;
    mostRecent?: Date;
  } {
    const byCode: Record<string, number> = {};
    let mostRecent: Date | undefined;

    for (const error of this.errors) {
      byCode[error.code] = (byCode[error.code] || 0) + 1;
      if (!mostRecent || error.timestamp > mostRecent) {
        mostRecent = error.timestamp;
      }
    }

    const stats = {
      total: this.errors.length,
      byCode
    } as {
      total: number;
      byCode: Record<string, number>;
      mostRecent?: Date;
    };

    if (mostRecent) {
      stats.mostRecent = mostRecent;
    }

    return stats;
  }

  /**
   * 에러 발생률이 임계치를 초과하는지 확인
   */
  isErrorRateHigh(
    timeWindowMs: number = 5 * 60 * 1000, // 5분
    threshold: number = 10
  ): boolean {
    const cutoffTime = new Date(Date.now() - timeWindowMs);
    const recentErrors = this.getErrorsSince(cutoffTime);
    return recentErrors.length >= threshold;
  }

  /**
   * 특정 에러 코드의 발생 빈도가 높은지 확인
   */
  isFrequentError(
    code: string,
    timeWindowMs: number = 5 * 60 * 1000, // 5분
    threshold: number = 5
  ): boolean {
    const cutoffTime = new Date(Date.now() - timeWindowMs);
    const recentErrors = this.getErrorsSince(cutoffTime);
    const codeErrors = recentErrors.filter(error => error.code === code);
    return codeErrors.length >= threshold;
  }
}
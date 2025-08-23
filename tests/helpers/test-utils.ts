/**
 * 공통 테스트 유틸리티
 * 테스트에서 자주 사용하는 헬퍼 함수들
 */

import { Logger } from '@/services/logger';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 조건이 만족될 때까지 대기
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100,
  message = 'Condition not met'
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error(`${message} - Timeout after ${timeout}ms`);
}

/**
 * 지정된 시간만큼 대기
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 테스트용 Logger 생성
 */
export function createTestLogger(): jest.Mocked<Logger> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  } as any;
}

/**
 * 테스트 환경 설정
 */
export interface TestEnvironmentConfig {
  workspaceRoot?: string;
  cleanupAfter?: boolean;
  githubToken?: string;
  githubOwner?: string;
}

export function setupTestEnvironment(config?: TestEnvironmentConfig) {
  const defaults: TestEnvironmentConfig = {
    workspaceRoot: '/tmp/test-workspace',
    cleanupAfter: true,
    githubToken: 'test-token',
    githubOwner: 'test-owner'
  };
  
  const finalConfig = { ...defaults, ...config };
  
  // 환경 변수 설정
  process.env.GITHUB_TOKEN = finalConfig.githubToken!;
  process.env.GITHUB_OWNER = finalConfig.githubOwner!;
  process.env.NODE_ENV = 'test';
  
  // 작업 디렉토리 생성
  if (finalConfig.workspaceRoot && !fs.existsSync(finalConfig.workspaceRoot)) {
    fs.mkdirSync(finalConfig.workspaceRoot, { recursive: true });
  }
  
  // 정리 함수 반환
  return {
    cleanup: () => {
      if (finalConfig.cleanupAfter && finalConfig.workspaceRoot && fs.existsSync(finalConfig.workspaceRoot)) {
        fs.rmSync(finalConfig.workspaceRoot, { recursive: true, force: true });
      }
    },
    config: finalConfig
  };
}

/**
 * Mock 함수 호출 검증 헬퍼
 */
export function expectMockCalled(
  mockFn: jest.Mock,
  times?: number,
  withArgs?: any[]
): void {
  if (times !== undefined) {
    expect(mockFn).toHaveBeenCalledTimes(times);
  } else {
    expect(mockFn).toHaveBeenCalled();
  }
  
  if (withArgs) {
    expect(mockFn).toHaveBeenCalledWith(...withArgs);
  }
}

/**
 * Mock 함수 마지막 호출 인자 가져오기
 */
export function getLastCallArgs(mockFn: jest.Mock): any[] {
  const calls = mockFn.mock.calls;
  if (calls.length === 0) {
    throw new Error('Mock function was not called');
  }
  return calls[calls.length - 1];
}

/**
 * Mock 함수 특정 호출 인자 가져오기
 */
export function getCallArgs(mockFn: jest.Mock, callIndex: number): any[] {
  const calls = mockFn.mock.calls;
  if (calls.length <= callIndex) {
    throw new Error(`Mock function was called ${calls.length} times, but requested call index ${callIndex}`);
  }
  return calls[callIndex];
}

/**
 * 임시 디렉토리 생성 및 정리
 */
export class TempDirectory {
  private dirPath: string;
  
  constructor(prefix = 'test-temp') {
    this.dirPath = path.join(process.cwd(), `${prefix}-${Date.now()}`);
    fs.mkdirSync(this.dirPath, { recursive: true });
  }
  
  get path(): string {
    return this.dirPath;
  }
  
  createFile(filename: string, content: string): string {
    const filePath = path.join(this.dirPath, filename);
    const dir = path.dirname(filePath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, content);
    return filePath;
  }
  
  createDirectory(dirname: string): string {
    const dirPath = path.join(this.dirPath, dirname);
    fs.mkdirSync(dirPath, { recursive: true });
    return dirPath;
  }
  
  cleanup(): void {
    if (fs.existsSync(this.dirPath)) {
      fs.rmSync(this.dirPath, { recursive: true, force: true });
    }
  }
}

/**
 * Promise rejection 캡처
 */
export async function expectRejection<T = any>(
  promise: Promise<T>,
  errorMatcher?: string | RegExp | Error
): Promise<void> {
  try {
    await promise;
    throw new Error('Expected promise to reject, but it resolved');
  } catch (error) {
    if (errorMatcher) {
      if (typeof errorMatcher === 'string') {
        expect((error as Error).message).toContain(errorMatcher);
      } else if (errorMatcher instanceof RegExp) {
        expect((error as Error).message).toMatch(errorMatcher);
      } else if (errorMatcher instanceof Error) {
        expect(error).toEqual(errorMatcher);
      }
    }
  }
}

/**
 * Jest timer 헬퍼
 */
export class TimerHelper {
  static useFakeTimers(): void {
    jest.useFakeTimers();
  }
  
  static useRealTimers(): void {
    jest.useRealTimers();
  }
  
  static async advanceTimersByTime(ms: number): Promise<void> {
    jest.advanceTimersByTime(ms);
    // 마이크로태스크 큐 플러시
    await Promise.resolve();
  }
  
  static async runAllTimers(): Promise<void> {
    jest.runAllTimers();
    await Promise.resolve();
  }
  
  static async runOnlyPendingTimers(): Promise<void> {
    jest.runOnlyPendingTimers();
    await Promise.resolve();
  }
}

/**
 * 스냅샷 테스트 헬퍼
 */
export function expectSnapshot(value: any, snapshotName?: string): void {
  if (snapshotName) {
    expect(value).toMatchSnapshot(snapshotName);
  } else {
    expect(value).toMatchSnapshot();
  }
}

/**
 * 에러 메시지 매칭 헬퍼
 */
export function expectErrorMessage(
  fn: () => void | Promise<void>,
  expectedMessage: string | RegExp
): void | Promise<void> {
  if (typeof expectedMessage === 'string') {
    expect(fn).toThrow(expectedMessage);
  } else {
    expect(fn).toThrow(expectedMessage);
  }
}
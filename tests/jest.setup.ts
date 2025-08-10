/**
 * Jest 통합 설정 파일
 * - ESM 및 모킹 설정
 * - 테스트 환경 설정
 * - 글로벌 설정 및 정리
 */

import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// ==========================================
// 1. 환경 변수 설정
// ==========================================

// 테스트 환경 변수 로드
config({ path: '.env.test', debug: false });

// 기본 테스트 환경 설정
process.env.NODE_ENV = 'test';

// GitHub 테스트 설정
process.env.GITHUB_OWNER = process.env.GITHUB_OWNER || 'test-owner';
process.env.GITHUB_PROJECT_NUMBER = process.env.GITHUB_PROJECT_NUMBER || '1';
process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'test-token';

// ==========================================
// 2. 글로벌 모킹 설정
// ==========================================

// @octokit/rest 모킹 (ESM 호환성 문제 해결)
jest.mock('@octokit/rest');

// Console 메소드 모킹 (테스트 출력 노이즈 방지)
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

// ==========================================
// 3. 테스트 라이프사이클 훅
// ==========================================

// 임시 파일 정리 함수
const cleanupTempFiles = () => {
  const tempPaths = [
    path.join(process.cwd(), 'temp-state'),
    path.join(process.cwd(), 'test-workspace'),
    path.join(process.cwd(), 'temp-test-*')
  ];

  tempPaths.forEach(tempPath => {
    if (tempPath.includes('*')) {
      // 와일드카드 패턴 처리
      const dir = path.dirname(tempPath);
      const pattern = path.basename(tempPath).replace('*', '.*');
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
          if (new RegExp(pattern).test(file)) {
            const fullPath = path.join(dir, file);
            fs.rmSync(fullPath, { recursive: true, force: true });
          }
        });
      }
    } else if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { recursive: true, force: true });
    }
  });
};

// 전역 setup
beforeAll(() => {
  // 초기 정리
  cleanupTempFiles();
});

// 각 테스트 전 정리
beforeEach(() => {
  // Jest 타이머 리셋
  jest.clearAllTimers();
  jest.useRealTimers();
});

// 전역 cleanup
afterAll(() => {
  // 최종 정리
  cleanupTempFiles();
  
  // 모든 Jest 모킹 정리
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

// ==========================================
// 4. 글로벌 테스트 유틸리티
// ==========================================

// 타임아웃 헬퍼
global.testTimeout = (ms: number) => {
  jest.setTimeout(ms);
};

// 조건 대기 헬퍼
global.waitFor = async (
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
};

// ==========================================
// 5. TypeScript 타입 선언
// ==========================================

declare global {
  var testTimeout: (ms: number) => void;
  var waitFor: (
    condition: () => boolean | Promise<boolean>,
    timeout?: number,
    interval?: number
  ) => Promise<void>;
}

export {};
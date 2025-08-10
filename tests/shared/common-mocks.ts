/**
 * 공통 모킹 설정
 * 여러 테스트에서 재사용되는 모킹 설정
 */

import { Octokit } from '@octokit/rest';
import { spawn, exec, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

/**
 * Child Process Mock 생성
 */
export function createMockChildProcess(
  stdout = '',
  stderr = '',
  exitCode = 0,
  signal?: string
): ChildProcess {
  const mockProcess = new EventEmitter() as ChildProcess;
  
  // stdout mock
  mockProcess.stdout = new EventEmitter() as any;
  mockProcess.stdout.on = jest.fn((event, callback) => {
    if (event === 'data' && stdout) {
      process.nextTick(() => callback(Buffer.from(stdout)));
    }
    return mockProcess.stdout!;
  });
  
  // stderr mock
  mockProcess.stderr = new EventEmitter() as any;
  mockProcess.stderr.on = jest.fn((event, callback) => {
    if (event === 'data' && stderr) {
      process.nextTick(() => callback(Buffer.from(stderr)));
    }
    return mockProcess.stderr!;
  });
  
  // stdin mock
  mockProcess.stdin = {
    write: jest.fn(),
    end: jest.fn()
  } as any;
  
  // Process events
  mockProcess.on = jest.fn((event, callback) => {
    if (event === 'close') {
      process.nextTick(() => callback(exitCode, signal));
    } else if (event === 'exit') {
      process.nextTick(() => callback(exitCode, signal));
    }
    return mockProcess;
  }) as any;
  
  mockProcess.kill = jest.fn(() => true);
  mockProcess.killed = false;
  mockProcess.pid = Math.floor(Math.random() * 10000);
  
  return mockProcess;
}

/**
 * Octokit Mock 설정
 */
export function setupOctokitMock(): jest.Mocked<Octokit> {
  const mockOctokit = {
    rest: {
      repos: {
        get: jest.fn(),
        createForAuthenticatedUser: jest.fn(),
        listForAuthenticatedUser: jest.fn()
      },
      pulls: {
        get: jest.fn(),
        list: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        merge: jest.fn(),
        listReviews: jest.fn(),
        listCommentsForRepo: jest.fn(),
        createReview: jest.fn(),
        createReviewComment: jest.fn()
      },
      issues: {
        get: jest.fn(),
        list: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        listComments: jest.fn(),
        createComment: jest.fn(),
        listEvents: jest.fn()
      },
      projects: {
        listForRepo: jest.fn(),
        listForOrg: jest.fn(),
        listForUser: jest.fn(),
        get: jest.fn(),
        listColumns: jest.fn(),
        listCards: jest.fn(),
        getCard: jest.fn(),
        updateCard: jest.fn(),
        moveCard: jest.fn()
      }
    },
    request: jest.fn(),
    graphql: jest.fn(),
    log: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }
  };
  
  return mockOctokit as any;
}

/**
 * Git Command Mock 설정
 */
export interface GitMockConfig {
  clone?: { success: boolean; output?: string };
  fetch?: { success: boolean; output?: string };
  checkout?: { success: boolean; output?: string };
  pull?: { success: boolean; output?: string };
  push?: { success: boolean; output?: string };
  worktree?: { success: boolean; output?: string };
  status?: { success: boolean; output?: string };
  branch?: { success: boolean; output?: string };
}

export function setupGitMocks(config: GitMockConfig = {}): void {
  const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
  const mockExec = exec as jest.MockedFunction<typeof exec>;
  
  mockSpawn.mockImplementation((command, args) => {
    const gitCommand = args?.[0];
    
    switch (gitCommand) {
      case 'clone':
        return createMockChildProcess(
          config.clone?.output || 'Cloning into repository...',
          '',
          config.clone?.success ? 0 : 1
        );
      
      case 'fetch':
        return createMockChildProcess(
          config.fetch?.output || 'From https://github.com/test/repo',
          '',
          config.fetch?.success ? 0 : 1
        );
      
      case 'checkout':
        return createMockChildProcess(
          config.checkout?.output || 'Switched to branch',
          '',
          config.checkout?.success ? 0 : 1
        );
      
      case 'worktree':
        return createMockChildProcess(
          config.worktree?.output || 'Preparing worktree',
          '',
          config.worktree?.success ? 0 : 1
        );
      
      default:
        return createMockChildProcess('', '', 0);
    }
  });
  
  mockExec.mockImplementation((command, callback: any) => {
    if (command.includes('git status')) {
      callback(
        config.status?.success ? null : new Error('Command failed'),
        config.status?.output || 'On branch main',
        ''
      );
    } else if (command.includes('git branch')) {
      callback(
        config.branch?.success ? null : new Error('Command failed'),
        config.branch?.output || '* main',
        ''
      );
    } else {
      callback(null, '', '');
    }
  });
}

/**
 * 환경 변수 Mock
 */
export class EnvironmentMock {
  private originalEnv: NodeJS.ProcessEnv;
  private mockEnv: NodeJS.ProcessEnv;
  
  constructor(mockValues: NodeJS.ProcessEnv = {}) {
    this.originalEnv = { ...process.env };
    this.mockEnv = mockValues;
  }
  
  apply(): void {
    Object.keys(this.mockEnv).forEach(key => {
      process.env[key] = this.mockEnv[key];
    });
  }
  
  restore(): void {
    process.env = { ...this.originalEnv };
  }
  
  set(key: string, value: string): void {
    process.env[key] = value;
  }
  
  unset(key: string): void {
    delete process.env[key];
  }
}

/**
 * 파일 시스템 Mock
 */
export class FileSystemMock {
  private files: Map<string, string> = new Map();
  private directories: Set<string> = new Set();
  
  addFile(path: string, content: string): void {
    this.files.set(path, content);
    this.addDirectory(path.substring(0, path.lastIndexOf('/')));
  }
  
  addDirectory(path: string): void {
    this.directories.add(path);
    // 상위 디렉토리도 추가
    const parent = path.substring(0, path.lastIndexOf('/'));
    if (parent && parent !== path) {
      this.addDirectory(parent);
    }
  }
  
  existsSync(path: string): boolean {
    return this.files.has(path) || this.directories.has(path);
  }
  
  readFileSync(path: string): string {
    if (!this.files.has(path)) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return this.files.get(path)!;
  }
  
  writeFileSync(path: string, content: string): void {
    this.addFile(path, content);
  }
  
  mkdirSync(path: string): void {
    this.addDirectory(path);
  }
  
  clear(): void {
    this.files.clear();
    this.directories.clear();
  }
}
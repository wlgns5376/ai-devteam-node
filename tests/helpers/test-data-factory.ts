/**
 * 테스트 데이터 팩토리
 * 테스트에서 사용할 모킹 데이터를 일관되게 생성
 */

import { 
  Worker, 
  WorkerStatus, 
  WorkerTask,
  WorkerAction,
  ProjectBoardItem,
  PullRequestComment,
  TaskRequest,
  TaskAction,
  ResponseStatus,
  ServiceProvider
} from '@/types';
import { AppConfig } from '@/config/app-config';

/**
 * 테스트 데이터 생성 팩토리 클래스
 */
export class TestDataFactory {
  
  /**
   * Mock Worker 생성
   */
  static createMockWorker(overrides?: Partial<Worker>): Worker {
    const defaultWorker: Worker = {
      id: `worker-${Math.random().toString(36).substr(2, 9)}`,
      status: WorkerStatus.IDLE,
      workspaceDir: `/tmp/test/worker-${Date.now()}`,
      developerType: 'claude',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      ...overrides
    };
    
    return defaultWorker;
  }

  /**
   * Mock WorkerTask 생성
   */
  static createMockWorkerTask(overrides?: Partial<WorkerTask>): WorkerTask {
    return {
      taskId: `PVTI_${Math.random().toString(36).substr(2, 9)}`,
      action: WorkerAction.START_NEW_TASK,
      assignedAt: new Date(),
      repositoryId: 'test-owner/test-repo',
      ...overrides
    };
  }

  /**
   * Mock TaskRequest 생성
   */
  static createMockTaskRequest(overrides?: Partial<TaskRequest>): TaskRequest {
    const taskId = overrides?.taskId || `PVTI_${Math.random().toString(36).substr(2, 9)}`;
    
    return {
      taskId,
      action: TaskAction.START_NEW_TASK,
      boardItem: this.createMockBoardItem({ id: taskId }),
      ...overrides
    };
  }

  /**
   * Mock ProjectBoardItem 생성
   */
  static createMockBoardItem(overrides?: Partial<ProjectBoardItem>): ProjectBoardItem {
    return {
      id: `PVTI_${Math.random().toString(36).substr(2, 9)}`,
      title: 'Test Task',
      description: 'Test task content',
      status: 'TODO',
      assignee: null,
      labels: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      pullRequestUrls: [],
      ...overrides
    };
  }

  /**
   * Mock PullRequestComment 생성
   */
  static createMockComment(overrides?: Partial<PullRequestComment>): PullRequestComment {
    return {
      id: Math.random().toString(36).substr(2, 9),
      author: 'test-user',
      content: 'Test comment content',
      createdAt: new Date(),
      ...overrides
    };
  }

  /**
   * Mock AppConfig 생성
   */
  static createMockConfig(overrides?: Partial<AppConfig>): AppConfig {
    const defaultConfig: AppConfig = {
      nodeEnv: 'test',
      planner: {
        boardId: 'test-board-id',
        repoId: 'test-owner/test-repo',
        monitoringIntervalMs: 15000,
        maxRetryAttempts: 3,
        timeoutMs: 60000,
        repositoryFilter: {
          allowedRepositories: ['test-owner/test-repo'],
          mode: 'whitelist'
        },
        pullRequestFilter: {
          allowedBots: ['dependabot[bot]'],
          excludeAuthor: true
        }
      },
      manager: {
        workspaceRoot: '/tmp/test-workspace',
        workerPool: {
          minWorkers: 1,
          maxWorkers: 3,
          workerTimeoutMs: 300000
        },
        gitOperationTimeoutMs: 60000,
        repositoryCacheTimeoutMs: 300000,
        gitConfig: {
          cloneDepth: 1,
          enableConcurrencyLock: true
        },
        pullRequest: {
          provider: ServiceProvider.GITHUB,
          config: {
            type: ServiceProvider.GITHUB,
            apiToken: 'test-token',
            baseUrl: 'https://api.github.com'
          }
        }
      },
      developer: {
        claudeCodePath: 'claude',
        claudeCodeTimeoutMs: 300000,
        geminiCliPath: 'gemini',
        geminiCliTimeoutMs: 300000
      },
      logger: {
        level: 'info',
        filePath: './logs/test.log',
        enableConsole: false
      },
      pullRequestFilter: {
        allowedBots: ['dependabot[bot]'],
        excludeAuthor: true
      }
    };

    // 깊은 병합 수행
    return this.deepMerge(defaultConfig, overrides || {}) as AppConfig;
  }

  /**
   * Mock GitHub API 응답 생성
   */
  static createMockGitHubResponse(type: 'repo' | 'pull' | 'issue', overrides?: any) {
    const baseResponse = {
      data: {},
      status: 200,
      headers: {},
      url: 'https://api.github.com'
    };

    switch (type) {
      case 'repo':
        return {
          ...baseResponse,
          data: {
            id: 123456,
            name: 'test-repo',
            full_name: 'test-owner/test-repo',
            owner: { login: 'test-owner' },
            default_branch: 'main',
            ...overrides
          }
        };
      
      case 'pull':
        return {
          ...baseResponse,
          data: {
            id: 1,
            number: 1,
            title: 'Test PR',
            state: 'open',
            html_url: 'https://github.com/test-owner/test-repo/pull/1',
            user: { login: 'test-user' },
            ...overrides
          }
        };
      
      case 'issue':
        return {
          ...baseResponse,
          data: {
            id: 1,
            number: 1,
            title: 'Test Issue',
            state: 'open',
            html_url: 'https://github.com/test-owner/test-repo/issues/1',
            user: { login: 'test-user' },
            ...overrides
          }
        };
      
      default:
        return baseResponse;
    }
  }

  /**
   * 깊은 병합 유틸리티
   */
  private static deepMerge(target: any, source: any): any {
    const output = { ...target };
    
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    
    return output;
  }

  private static isObject(item: any): boolean {
    return item && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Date);
  }
}
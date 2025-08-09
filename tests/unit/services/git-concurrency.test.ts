import { GitService } from '@/services/git/git.service';
import { Logger } from '@/services/logger';

// Mock GitLockService for testing concurrency
class MockGitLockService {
  private locks = new Map<string, Promise<void>>();
  private lockCallOrder: string[] = [];
  private operationCallOrder: string[] = [];

  async withLock<T>(repoId: string, operation: () => Promise<T>): Promise<T> {
    this.lockCallOrder.push(`lock-${repoId}`);
    
    // 기존 작업이 있으면 대기
    const existingLock = this.locks.get(repoId);
    if (existingLock) {
      await existingLock;
    }
    
    // 새로운 작업 실행
    const operationPromise = operation();
    this.locks.set(repoId, operationPromise.then(() => {}));
    
    this.operationCallOrder.push(`exec-${repoId}`);
    
    try {
      return await operationPromise;
    } finally {
      this.locks.delete(repoId);
      this.operationCallOrder.push(`done-${repoId}`);
    }
  }

  getLockCallOrder(): string[] {
    return [...this.lockCallOrder];
  }

  getOperationCallOrder(): string[] {
    return [...this.operationCallOrder];
  }

  clearHistory(): void {
    this.lockCallOrder = [];
    this.operationCallOrder = [];
  }

  hasActiveLock(repoId: string): boolean {
    return this.locks.has(repoId);
  }
}

// Mock Worker for testing concurrent Git operations
class MockWorker {
  constructor(
    public id: string,
    private gitService: GitService,
    private gitLockService: MockGitLockService
  ) {}

  async setupWorkspace(repositoryId: string, taskId: string): Promise<void> {
    return this.gitLockService.withLock(repositoryId, async () => {
      // Git 작업 시뮬레이션
      await this.gitService.fetch(repositoryId);
      await this.simulateWorktreeOperation(repositoryId, taskId);
      return Promise.resolve();
    });
  }

  private async simulateWorktreeOperation(repositoryId: string, taskId: string): Promise<void> {
    // worktree 생성 시뮬레이션 (50ms 지연)
    return new Promise(resolve => {
      setTimeout(() => {
        resolve();
      }, 50);
    });
  }
}

describe('Git 동시성 제어 테스트', () => {
  let gitService: GitService;
  let gitLockService: MockGitLockService;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = Logger.createConsoleLogger();
    gitService = new GitService(mockLogger);
    gitLockService = new MockGitLockService();
  });

  describe('기본 락 동작', () => {
    it('동일한 저장소에 대한 동시 접근을 순차적으로 처리해야 한다', async () => {
      // Given: 동일한 저장소에 대한 두 개의 동시 작업
      const repoId = 'owner/repo';
      const operations: Promise<string>[] = [];

      const operation1 = gitLockService.withLock(repoId, async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'operation-1-completed';
      });

      const operation2 = gitLockService.withLock(repoId, async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'operation-2-completed';
      });

      operations.push(operation1, operation2);

      // When: 두 작업을 동시에 실행하면
      const results = await Promise.all(operations);

      // Then: 순차적으로 실행되어야 함
      expect(results).toEqual(['operation-1-completed', 'operation-2-completed']);
      
      // 락 호출 순서 확인
      const callOrder = gitLockService.getOperationCallOrder();
      expect(callOrder).toEqual([
        'exec-owner/repo',
        'done-owner/repo', 
        'exec-owner/repo',
        'done-owner/repo'
      ]);
    });

    it('서로 다른 저장소에 대한 작업은 병렬로 처리해야 한다', async () => {
      // Given: 서로 다른 저장소에 대한 두 개의 작업
      const repo1 = 'owner/repo1';
      const repo2 = 'owner/repo2';
      const operations: Promise<string>[] = [];

      const operation1 = gitLockService.withLock(repo1, async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'repo1-completed';
      });

      const operation2 = gitLockService.withLock(repo2, async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'repo2-completed';
      });

      operations.push(operation1, operation2);

      // When: 두 작업을 동시에 실행하면
      const startTime = Date.now();
      const results = await Promise.all(operations);
      const endTime = Date.now();

      // Then: 병렬로 실행되어 시간이 단축되어야 함
      expect(results).toContain('repo1-completed');
      expect(results).toContain('repo2-completed');
      
      // 병렬 실행으로 200ms보다 짧아야 함 (여유분 포함하여 150ms로 검증)
      expect(endTime - startTime).toBeLessThan(150);
    });
  });

  describe('Worker 동시성 시나리오', () => {
    it('동일한 저장소에서 여러 Worker가 작업 시 순차 처리되어야 한다', async () => {
      // Given: 동일한 저장소에서 작업하는 여러 Worker
      const repoId = 'owner/shared-repo';
      const worker1 = new MockWorker('worker-1', gitService, gitLockService);
      const worker2 = new MockWorker('worker-2', gitService, gitLockService);
      const worker3 = new MockWorker('worker-3', gitService, gitLockService);

      // When: 세 Worker가 동시에 워크스페이스를 설정하면
      const setupPromises = [
        worker1.setupWorkspace(repoId, 'task-1'),
        worker2.setupWorkspace(repoId, 'task-2'),
        worker3.setupWorkspace(repoId, 'task-3')
      ];

      const startTime = Date.now();
      await Promise.all(setupPromises);
      const endTime = Date.now();

      // Then: 순차적으로 처리되어 시간이 누적되어야 함
      // 3개 작업 * 50ms ≈ 150ms 이상 소요
      expect(endTime - startTime).toBeGreaterThan(130);
      
      // 락이 올바르게 순차 실행되었는지 확인
      const lockCalls = gitLockService.getLockCallOrder();
      expect(lockCalls).toEqual([
        `lock-${repoId}`,
        `lock-${repoId}`,
        `lock-${repoId}`
      ]);
    });

    it('서로 다른 저장소에서 Worker들이 작업 시 병렬 처리되어야 한다', async () => {
      // Given: 서로 다른 저장소에서 작업하는 Worker들
      const worker1 = new MockWorker('worker-1', gitService, gitLockService);
      const worker2 = new MockWorker('worker-2', gitService, gitLockService);
      const worker3 = new MockWorker('worker-3', gitService, gitLockService);

      // When: 세 Worker가 각각 다른 저장소에서 작업하면
      const setupPromises = [
        worker1.setupWorkspace('owner/repo1', 'task-1'),
        worker2.setupWorkspace('owner/repo2', 'task-2'),
        worker3.setupWorkspace('owner/repo3', 'task-3')
      ];

      const startTime = Date.now();
      await Promise.all(setupPromises);
      const endTime = Date.now();

      // Then: 병렬 처리되어 시간이 단축되어야 함
      // 병렬 실행으로 50ms + 여유분
      expect(endTime - startTime).toBeLessThan(100);
    });
  });

  describe('에러 처리 및 락 해제', () => {
    it('작업 중 에러 발생 시에도 락이 해제되어야 한다', async () => {
      // Given: 에러가 발생하는 작업
      const repoId = 'owner/error-repo';
      
      const errorOperation = gitLockService.withLock(repoId, async () => {
        throw new Error('Simulated error');
      });

      // When: 에러가 발생하는 작업을 실행하면
      try {
        await errorOperation;
      } catch (error) {
        // 에러 발생 예상
      }

      // Then: 락이 해제되어 새로운 작업이 가능해야 함
      expect(gitLockService.hasActiveLock(repoId)).toBe(false);

      // 새로운 작업이 정상적으로 실행되어야 함
      const nextOperation = await gitLockService.withLock(repoId, async () => {
        return 'next-operation-success';
      });
      
      expect(nextOperation).toBe('next-operation-success');
    });

    it('여러 작업 중 하나가 실패해도 다른 작업에 영향을 주지 않아야 한다', async () => {
      // Given: 성공하는 작업과 실패하는 작업이 섞여 있음
      const repoId = 'owner/mixed-repo';
      
      const operations = [
        gitLockService.withLock(repoId, async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return 'success-1';
        }),
        gitLockService.withLock(repoId, async () => {
          await new Promise(resolve => setTimeout(resolve, 30));
          throw new Error('Failed operation');
        }),
        gitLockService.withLock(repoId, async () => {
          await new Promise(resolve => setTimeout(resolve, 40));
          return 'success-2';
        })
      ];

      // When: 모든 작업을 실행하면
      const results = await Promise.allSettled(operations);

      // Then: 성공한 작업들은 정상 결과를 반환해야 함
      expect(results[0].status).toBe('fulfilled');
      expect((results[0] as PromiseFulfilledResult<string>).value).toBe('success-1');
      
      expect(results[1].status).toBe('rejected');
      expect((results[1] as PromiseRejectedResult).reason.message).toBe('Failed operation');
      
      expect(results[2].status).toBe('fulfilled');
      expect((results[2] as PromiseFulfilledResult<string>).value).toBe('success-2');
    });
  });

  describe('고부하 동시성 테스트', () => {
    it('대량의 동시 요청을 안전하게 처리해야 한다', async () => {
      // Given: 동일한 저장소에 대한 많은 동시 요청
      const repoId = 'owner/heavy-load-repo';
      const numberOfOperations = 10;
      
      const operations = Array.from({ length: numberOfOperations }, (_, index) => 
        gitLockService.withLock(repoId, async () => {
          await new Promise(resolve => setTimeout(resolve, 10)); // 짧은 작업 시간
          return `operation-${index}`;
        })
      );

      // When: 모든 작업을 동시에 실행하면
      const results = await Promise.all(operations);

      // Then: 모든 작업이 성공해야 함
      expect(results).toHaveLength(numberOfOperations);
      
      results.forEach((result, index) => {
        expect(result).toBe(`operation-${index}`);
      });

      // 모든 락이 해제되어야 함
      expect(gitLockService.hasActiveLock(repoId)).toBe(false);
    });

    it('여러 저장소에 대한 대량 요청을 효율적으로 처리해야 한다', async () => {
      // Given: 여러 저장소에 대한 많은 동시 요청
      const numberOfRepos = 5;
      const operationsPerRepo = 4;
      
      const allOperations: Promise<string>[] = [];
      
      for (let repoIndex = 0; repoIndex < numberOfRepos; repoIndex++) {
        const repoId = `owner/repo-${repoIndex}`;
        
        for (let opIndex = 0; opIndex < operationsPerRepo; opIndex++) {
          const operation = gitLockService.withLock(repoId, async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
            return `repo-${repoIndex}-op-${opIndex}`;
          });
          
          allOperations.push(operation);
        }
      }

      // When: 모든 작업을 동시에 실행하면
      const startTime = Date.now();
      const results = await Promise.all(allOperations);
      const endTime = Date.now();

      // Then: 병렬 처리로 효율적으로 완료되어야 함
      expect(results).toHaveLength(numberOfRepos * operationsPerRepo);
      
      // 병렬 처리로 인해 총 시간이 단일 저장소 순차 처리보다 짧아야 함
      // 단일 저장소 기준: 4 operations * 20ms = 80ms
      // 5개 저장소 병렬: ~80ms (여유분 포함하여 100ms로 검증)
      expect(endTime - startTime).toBeLessThan(100);
    });
  });

  describe('락 상태 모니터링', () => {
    it('활성 락 상태를 올바르게 추적해야 한다', async () => {
      // Given: 진행 중인 작업
      const repoId = 'owner/monitoring-repo';
      
      let lockAcquired = false;
      let lockReleased = false;
      
      const longRunningOperation = gitLockService.withLock(repoId, async () => {
        lockAcquired = true;
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'completed';
      });

      // When: 작업 중간에 락 상태를 확인하면
      await new Promise(resolve => setTimeout(resolve, 50));
      const hasLockDuringExecution = gitLockService.hasActiveLock(repoId);
      
      // Then: 활성 락이 있어야 함
      expect(hasLockDuringExecution).toBe(true);
      expect(lockAcquired).toBe(true);

      // When: 작업이 완료된 후 락 상태를 확인하면
      await longRunningOperation;
      const hasLockAfterCompletion = gitLockService.hasActiveLock(repoId);
      
      // Then: 활성 락이 없어야 함
      expect(hasLockAfterCompletion).toBe(false);
    });
  });
});
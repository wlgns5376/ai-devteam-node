import { Logger } from '@/services/logger';

// Mock GitLockService for testing concurrency
class MockGitLockService {
  private locks = new Map<string, Promise<void>>();
  private activeLocks = new Set<string>();
  private lockCallOrder: string[] = [];
  private operationCallOrder: string[] = [];
  private operationExecutionOrder: Array<{ repositoryId: string; operation: string; timestamp: number }> = [];
  readonly lockTimeoutMs = 5000;
  readonly dependencies = { logger: Logger.createConsoleLogger() };

  async acquireLock(repositoryId: string, operation: 'clone' | 'fetch' | 'pull' | 'worktree'): Promise<void> {
    // Mock implementation
  }

  releaseLock(repositoryId: string, operation: 'clone' | 'fetch' | 'pull' | 'worktree'): void {
    // Mock implementation
  }

  async withLock<T>(
    repositoryId: string, 
    operation: 'clone' | 'fetch' | 'pull' | 'worktree',
    fn: () => Promise<T>
  ): Promise<T> {
    this.lockCallOrder.push(`lock-${repositoryId}-${operation}`);
    
    // 동일한 저장소에 대한 모든 작업은 순차 처리 
    const repoLockKey = repositoryId;
    
    // 해당 저장소에 대한 기존 작업이 있으면 대기
    while (this.locks.has(repoLockKey)) {
      await this.locks.get(repoLockKey);
    }
    
    // 새로운 작업 실행
    const lockKey = `${repositoryId}:${operation}`;
    this.activeLocks.add(lockKey);
    this.operationCallOrder.push(`exec-${repositoryId}-${operation}`);
    this.operationExecutionOrder.push({ 
      repositoryId, 
      operation, 
      timestamp: Date.now() 
    });
    
    // 작업 실행 Promise를 생성
    let resolveLock: () => void;
    let rejectLock: (error: any) => void;
    const lockPromise = new Promise<void>((resolve, reject) => {
      resolveLock = resolve;
      rejectLock = reject;
    });
    this.locks.set(repoLockKey, lockPromise);
    
    try {
      const result = await fn();
      return result;
    } catch (error) {
      // 에러가 발생해도 다른 대기 중인 작업에게 진행 신호를 보내야 함
      // rejectLock를 호출하면 대기 중인 모든 작업이 실패하므로 호출하지 않음
      throw error;
    } finally {
      this.activeLocks.delete(lockKey);
      this.operationCallOrder.push(`done-${repositoryId}-${operation}`);
      this.locks.delete(repoLockKey);
      resolveLock!(); // 대기 중인 다른 작업들에게 진행 신호
    }
  }

  isLocked(repositoryId: string, operation?: 'clone' | 'fetch' | 'pull' | 'worktree'): boolean {
    if (operation) {
      const lockKey = `${repositoryId}:${operation}`;
      return this.activeLocks.has(lockKey);
    }
    
    // operation이 지정되지 않으면 모든 작업에 대해 확인
    const operations: Array<'clone' | 'fetch' | 'pull' | 'worktree'> = ['clone', 'fetch', 'pull', 'worktree'];
    return operations.some(op => this.isLocked(repositoryId, op));
  }

  getCurrentLocks(): ReadonlyArray<any> {
    return Array.from(this.activeLocks);
  }

  getLockKey(repositoryId: string, operation: 'clone' | 'fetch' | 'pull' | 'worktree'): string {
    return `${repositoryId}:${operation}`;
  }

  isLockExpired(lock: any): boolean {
    return false; // Mock implementation
  }

  cleanupExpiredLocks(): void {
    // Mock implementation
  }

  delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  clearAllLocks(): void {
    this.locks.clear();
    this.activeLocks.clear();
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
    this.operationExecutionOrder = [];
  }

  hasActiveLock(repositoryId: string): boolean {
    // 해당 repositoryId와 관련된 모든 작업에 대해 락이 있는지 확인
    const operations: Array<'clone' | 'fetch' | 'pull' | 'worktree'> = ['clone', 'fetch', 'pull', 'worktree'];
    return operations.some(op => {
      const lockKey = `${repositoryId}:${op}`;
      return this.activeLocks.has(lockKey);
    });
  }

  getOperationExecutionOrder(): ReadonlyArray<{ repositoryId: string; operation: string; timestamp: number }> {
    return [...this.operationExecutionOrder];
  }

  // 동시성 검증을 위한 헬퍼 메서드들
  verifySequentialExecution(repositoryId: string): boolean {
    const repoOperations = this.operationExecutionOrder.filter(op => op.repositoryId === repositoryId);
    if (repoOperations.length <= 1) return true;
    
    // 타임스탬프가 순차적으로 증가하는지 확인
    for (let i = 1; i < repoOperations.length; i++) {
      const current = repoOperations[i];
      const previous = repoOperations[i - 1];
      if (!current || !previous || current.timestamp <= previous.timestamp) {
        return false;
      }
    }
    return true;
  }

  verifyParallelExecution(repositoryIds: string[]): boolean {
    if (repositoryIds.length <= 1) return true;
    
    const operations = repositoryIds.map(repoId => 
      this.operationExecutionOrder.find(op => op.repositoryId === repoId)
    ).filter(op => op !== undefined);
    
    if (operations.length <= 1) return true;
    
    // 첫 번째와 마지막 작업의 시작 시간 차이가 작아야 함 (병렬 실행 증거)
    const firstTimestamp = Math.min(...operations.map(op => op!.timestamp));
    const lastTimestamp = Math.max(...operations.map(op => op!.timestamp));
    
    // 50ms 이내에 모든 작업이 시작되었으면 병렬로 간주
    return (lastTimestamp - firstTimestamp) < 50;
  }
}

// Mock Worker for testing concurrent Git operations
class MockWorker {
  constructor(
    public id: string,
    private gitLockService: MockGitLockService
  ) {}

  async setupWorkspace(repositoryId: string, taskId: string): Promise<void> {
    return this.gitLockService.withLock(repositoryId, 'worktree', async () => {
      // Git 작업 시뮬레이션 - fetch를 모킹
      await this.simulateFetchOperation(repositoryId);
      await this.simulateWorktreeOperation(repositoryId, taskId);
      return Promise.resolve();
    });
  }

  private async simulateFetchOperation(repositoryId: string): Promise<void> {
    // fetch 작업 시뮬레이션 (30ms 지연)
    return new Promise(resolve => {
      setTimeout(() => {
        resolve();
      }, 30);
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
  let gitLockService: MockGitLockService;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = Logger.createConsoleLogger();
    gitLockService = new MockGitLockService();
  });

  afterEach(() => {
    // 테스트 간 격리를 위한 정리
    gitLockService.clearAllLocks();
    gitLockService.clearHistory();
  });

  describe('기본 락 동작', () => {
    it('동일한 저장소에 대한 동시 접근을 순차적으로 처리해야 한다', async () => {
      // Given: 동일한 저장소에 대한 두 개의 동시 작업
      const repoId = 'owner/repo';
      const operations: Promise<string>[] = [];

      const operation1 = gitLockService.withLock(repoId, 'clone', async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'operation-1-completed';
      });

      const operation2 = gitLockService.withLock(repoId, 'fetch', async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'operation-2-completed';
      });

      operations.push(operation1, operation2);

      // When: 두 작업을 동시에 실행하면
      const results = await Promise.all(operations);

      // Then: 순차적으로 실행되어야 함
      expect(results).toEqual(['operation-1-completed', 'operation-2-completed']);
      
      // 락 호출 순서 확인 - 더 유연한 검증
      const callOrder = gitLockService.getOperationCallOrder();
      expect(callOrder).toHaveLength(4);
      expect(callOrder.filter(call => call.includes('exec-'))).toHaveLength(2);
      expect(callOrder.filter(call => call.includes('done-'))).toHaveLength(2);
      
      // 순차적 실행 검증
      expect(gitLockService.verifySequentialExecution(repoId)).toBe(true);
    });

    it('서로 다른 저장소에 대한 작업은 병렬로 처리해야 한다', async () => {
      // Given: 서로 다른 저장소에 대한 두 개의 작업
      const repo1 = 'owner/repo1';
      const repo2 = 'owner/repo2';
      const operations: Promise<string>[] = [];

      const operation1 = gitLockService.withLock(repo1, 'clone', async () => {
        await new Promise(resolve => setTimeout(resolve, 80));
        return 'repo1-completed';
      });

      const operation2 = gitLockService.withLock(repo2, 'fetch', async () => {
        await new Promise(resolve => setTimeout(resolve, 80));
        return 'repo2-completed';
      });

      operations.push(operation1, operation2);

      // When: 두 작업을 동시에 실행하면
      const startTime = Date.now();
      const results = await Promise.all(operations);
      const endTime = Date.now();

      // Then: 병렬로 실행되어야 함
      expect(results).toContain('repo1-completed');
      expect(results).toContain('repo2-completed');
      
      // 병렬 실행 검증 - 헬퍼 메서드 사용
      expect(gitLockService.verifyParallelExecution([repo1, repo2])).toBe(true);
      
      // 시간 검증 - 더 유연한 범위
      const executionTime = endTime - startTime;
      expect(executionTime).toBeGreaterThan(70); // 최소 실행 시간
      expect(executionTime).toBeLessThan(130); // 병렬 실행으로 단축된 시간
    });
  });

  describe('Worker 동시성 시나리오', () => {
    it('동일한 저장소에서 여러 Worker가 작업 시 순차 처리되어야 한다', async () => {
      // Given: 동일한 저장소에서 작업하는 여러 Worker
      const repoId = 'owner/shared-repo';
      const worker1 = new MockWorker('worker-1', gitLockService);
      const worker2 = new MockWorker('worker-2', gitLockService);
      const worker3 = new MockWorker('worker-3', gitLockService);

      // When: 세 Worker가 동시에 워크스페이스를 설정하면
      const setupPromises = [
        worker1.setupWorkspace(repoId, 'task-1'),
        worker2.setupWorkspace(repoId, 'task-2'),
        worker3.setupWorkspace(repoId, 'task-3')
      ];

      const startTime = Date.now();
      await Promise.all(setupPromises);
      const endTime = Date.now();

      // Then: 순차적으로 처리되어야 함
      expect(gitLockService.verifySequentialExecution(repoId)).toBe(true);
      
      // 시간이 누적되어야 함 (3개 작업 * 80ms = 최소 200ms 이상)
      const executionTime = endTime - startTime;
      expect(executionTime).toBeGreaterThan(200);
      
      // 락 호출 횟수 확인
      const lockCalls = gitLockService.getLockCallOrder();
      expect(lockCalls.filter(call => call.includes(repoId))).toHaveLength(3);
    });

    it('서로 다른 저장소에서 Worker들이 작업 시 병렬 처리되어야 한다', async () => {
      // Given: 서로 다른 저장소에서 작업하는 Worker들
      const worker1 = new MockWorker('worker-1', gitLockService);
      const worker2 = new MockWorker('worker-2', gitLockService);
      const worker3 = new MockWorker('worker-3', gitLockService);

      const repos = ['owner/repo1', 'owner/repo2', 'owner/repo3'];

      // When: 세 Worker가 각각 다른 저장소에서 작업하면
      const setupPromises = [
        worker1.setupWorkspace(repos[0]!, 'task-1'),
        worker2.setupWorkspace(repos[1]!, 'task-2'),
        worker3.setupWorkspace(repos[2]!, 'task-3')
      ];

      const startTime = Date.now();
      await Promise.all(setupPromises);
      const endTime = Date.now();

      // Then: 병렬 처리되어야 함
      expect(gitLockService.verifyParallelExecution(repos)).toBe(true);
      
      // 병렬 실행으로 시간이 단축되어야 함 (80ms + 여유분)
      const executionTime = endTime - startTime;
      expect(executionTime).toBeGreaterThan(70); // 최소 실행 시간
      expect(executionTime).toBeLessThan(120); // 병렬로 단축된 시간
    });
  });

  describe('에러 처리 및 락 해제', () => {
    it('작업 중 에러 발생 시에도 락이 해제되어야 한다', async () => {
      // Given: 에러가 발생하는 작업
      const repoId = 'owner/error-repo';
      
      const errorOperation = gitLockService.withLock(repoId, 'clone', async () => {
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
      const nextOperation = await gitLockService.withLock(repoId, 'fetch', async () => {
        return 'next-operation-success';
      });
      
      expect(nextOperation).toBe('next-operation-success');
    });

    it('여러 작업 중 하나가 실패해도 다른 작업에 영향을 주지 않아야 한다', async () => {
      // Given: 성공하는 작업과 실패하는 작업이 섞여 있음
      const repoId = 'owner/mixed-repo';
      
      const operations = [
        gitLockService.withLock(repoId, 'clone', async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return 'success-1';
        }),
        gitLockService.withLock(repoId, 'clone', async () => {
          await new Promise(resolve => setTimeout(resolve, 30));
          throw new Error('Failed operation');
        }),
        gitLockService.withLock(repoId, 'clone', async () => {
          await new Promise(resolve => setTimeout(resolve, 40));
          return 'success-2';
        })
      ];

      // When: 모든 작업을 실행하면
      const results = await Promise.allSettled(operations);

      // Then: 성공한 작업들은 정상 결과를 반환해야 함
      expect(results.length).toBe(3);
      expect(results[0]!.status).toBe('fulfilled');
      expect((results[0]! as PromiseFulfilledResult<string>).value).toBe('success-1');
      
      expect(results[1]!.status).toBe('rejected');
      expect((results[1]! as PromiseRejectedResult).reason.message).toBe('Failed operation');
      
      expect(results[2]!.status).toBe('fulfilled');
      expect((results[2]! as PromiseFulfilledResult<string>).value).toBe('success-2');
    });
  });

  describe('고부하 동시성 테스트', () => {
    it('대량의 동시 요청을 안전하게 처리해야 한다', async () => {
      // Given: 동일한 저장소에 대한 많은 동시 요청
      const repoId = 'owner/heavy-load-repo';
      const numberOfOperations = 10;
      
      const operations = Array.from({ length: numberOfOperations }, (_, index) => 
        gitLockService.withLock(repoId, 'clone', async () => {
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
      const operationDelay = 15; // 더 안정적인 시간
      
      const allOperations: Promise<string>[] = [];
      const repoIds: string[] = [];
      
      for (let repoIndex = 0; repoIndex < numberOfRepos; repoIndex++) {
        const repoId = `owner/repo-${repoIndex}`;
        repoIds.push(repoId);
        
        for (let opIndex = 0; opIndex < operationsPerRepo; opIndex++) {
          const operation = gitLockService.withLock(repoId, 'clone', async () => {
            await new Promise(resolve => setTimeout(resolve, operationDelay));
            return `repo-${repoIndex}-op-${opIndex}`;
          });
          
          allOperations.push(operation);
        }
      }

      // When: 모든 작업을 동시에 실행하면
      const startTime = Date.now();
      const results = await Promise.all(allOperations);
      const endTime = Date.now();

      // Then: 모든 작업이 성공해야 함
      expect(results).toHaveLength(numberOfRepos * operationsPerRepo);
      
      // 각 저장소별로 순차 실행되었는지 확인
      repoIds.forEach(repoId => {
        expect(gitLockService.verifySequentialExecution(repoId)).toBe(true);
      });
      
      // 병렬 처리로 효율적이어야 함
      const executionTime = endTime - startTime;
      const sequentialTime = numberOfRepos * operationsPerRepo * operationDelay; // 모든 작업을 순차 실행한 시간
      const parallelTime = operationsPerRepo * operationDelay; // 병렬 실행 시간
      
      expect(executionTime).toBeGreaterThan(parallelTime - 10); // 최소한 병렬 실행 시간
      expect(executionTime).toBeLessThan(sequentialTime / 2); // 순차 실행의 절반보다 빨라야 함
    });
  });

  describe('락 상태 모니터링', () => {
    it('활성 락 상태를 올바르게 추적해야 한다', async () => {
      // Given: 진행 중인 작업
      const repoId = 'owner/monitoring-repo';
      
      let lockAcquired = false;
      
      const longRunningOperation = gitLockService.withLock(repoId, 'clone', async () => {
        lockAcquired = true;
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'completed';
      });

      // When: 작업 중간에 락 상태를 확인하면
      await new Promise(resolve => setTimeout(resolve, 10)); // 작업이 시작될 시간 확보
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
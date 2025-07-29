import { GitOperationLock } from '@/types/manager.types';
import { Logger } from '../logger';

interface GitLockServiceDependencies {
  readonly logger: Logger;
  readonly lockTimeoutMs?: number; // 기본 5분
}

export class GitLockService {
  private readonly locks: Map<string, GitOperationLock> = new Map();
  private readonly lockTimeoutMs: number;

  constructor(
    private readonly dependencies: GitLockServiceDependencies
  ) {
    this.lockTimeoutMs = dependencies.lockTimeoutMs || 5 * 60 * 1000; // 기본 5분
    
    // 주기적으로 만료된 락 정리
    setInterval(() => this.cleanupExpiredLocks(), 60000); // 1분마다
  }

  async acquireLock(
    repositoryId: string, 
    operation: 'clone' | 'fetch' | 'worktree'
  ): Promise<void> {
    const lockKey = this.getLockKey(repositoryId, operation);
    
    // 재시도 로직
    const maxRetries = 10;
    const retryDelayMs = 1000; // 1초
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const existingLock = this.locks.get(lockKey);
      
      if (!existingLock || this.isLockExpired(existingLock)) {
        // 락 획득
        const lock: GitOperationLock = {
          repositoryId,
          operation,
          acquiredAt: new Date()
        };
        
        this.locks.set(lockKey, lock);
        
        this.dependencies.logger.debug('Git operation lock acquired', {
          repositoryId,
          operation,
          lockKey,
          attempt
        });
        
        return;
      }
      
      // 락이 이미 있으면 대기
      this.dependencies.logger.debug('Waiting for git operation lock', {
        repositoryId,
        operation,
        lockKey,
        attempt,
        existingLock
      });
      
      await this.delay(retryDelayMs);
    }
    
    // 최대 재시도 횟수 초과
    throw new Error(
      `Failed to acquire lock for ${operation} on ${repositoryId} after ${maxRetries} attempts`
    );
  }

  releaseLock(repositoryId: string, operation: 'clone' | 'fetch' | 'worktree'): void {
    const lockKey = this.getLockKey(repositoryId, operation);
    const lock = this.locks.get(lockKey);
    
    if (lock) {
      this.locks.delete(lockKey);
      
      this.dependencies.logger.debug('Git operation lock released', {
        repositoryId,
        operation,
        lockKey,
        duration: Date.now() - lock.acquiredAt.getTime()
      });
    }
  }

  async withLock<T>(
    repositoryId: string,
    operation: 'clone' | 'fetch' | 'worktree',
    fn: () => Promise<T>
  ): Promise<T> {
    await this.acquireLock(repositoryId, operation);
    
    try {
      return await fn();
    } finally {
      this.releaseLock(repositoryId, operation);
    }
  }

  isLocked(repositoryId: string, operation?: 'clone' | 'fetch' | 'worktree'): boolean {
    if (operation) {
      const lockKey = this.getLockKey(repositoryId, operation);
      const lock = this.locks.get(lockKey);
      return lock ? !this.isLockExpired(lock) : false;
    }
    
    // operation이 지정되지 않으면 모든 작업에 대해 확인
    const operations: Array<'clone' | 'fetch' | 'worktree'> = ['clone', 'fetch', 'worktree'];
    return operations.some(op => this.isLocked(repositoryId, op));
  }

  getCurrentLocks(): ReadonlyArray<GitOperationLock> {
    return Array.from(this.locks.values())
      .filter(lock => !this.isLockExpired(lock));
  }

  private getLockKey(repositoryId: string, operation: string): string {
    return `${repositoryId}:${operation}`;
  }

  private isLockExpired(lock: GitOperationLock): boolean {
    const lockAge = Date.now() - lock.acquiredAt.getTime();
    return lockAge > this.lockTimeoutMs;
  }

  private cleanupExpiredLocks(): void {
    let expiredCount = 0;
    
    for (const [key, lock] of this.locks.entries()) {
      if (this.isLockExpired(lock)) {
        this.locks.delete(key);
        expiredCount++;
      }
    }
    
    if (expiredCount > 0) {
      this.dependencies.logger.info('Cleaned up expired git locks', {
        expiredCount,
        remainingLocks: this.locks.size
      });
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 테스트 및 디버깅용 메서드
  clearAllLocks(): void {
    const lockCount = this.locks.size;
    this.locks.clear();
    
    if (lockCount > 0) {
      this.dependencies.logger.warn('All git locks cleared manually', { lockCount });
    }
  }
}
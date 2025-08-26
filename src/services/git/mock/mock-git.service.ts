import { GitServiceInterface } from '@/types/manager.types';
import { Logger } from '../../logger';
import { GitLockService } from '../git-lock.service';
import * as path from 'path';

interface MockGitServiceDependencies {
  readonly logger: Logger;
  readonly gitLockService: GitLockService;
}

export class MockGitService implements GitServiceInterface {
  private clonedRepositories: Set<string> = new Set();
  private repositories: Map<string, { path: string; branches: string[] }> = new Map();
  private worktrees: Map<string, { repoPath: string; branchName: string; worktreePath: string }> = new Map();

  constructor(
    private readonly dependencies: MockGitServiceDependencies
  ) {
    // 테스트용 repository 미리 추가
    this.initializeTestRepositories();
  }
  
  private initializeTestRepositories(): void {
    // E2E 테스트를 위한 기본 repository는 필요시에만 동적으로 생성
    // 미리 생성하지 않고, clone 또는 fetch 시점에 필요하면 생성하도록 변경
    
    this.dependencies.logger.debug('Mock: Test repositories ready for dynamic initialization');
  }

  async clone(repositoryUrl: string, localPath: string): Promise<void> {
    // URL에서 repository ID 추출 (예: owner/repo)
    const repoId = this.extractRepoIdFromUrl(repositoryUrl);
    
    return this.dependencies.gitLockService.withLock(repoId, 'clone', async () => {
      this.dependencies.logger.info('Mock: Cloning repository', { repositoryUrl, localPath });
      
      // 실제 디렉토리 생성 없이 내부 상태만 업데이트
      this.clonedRepositories.add(repoId);
      this.repositories.set(repoId, { 
        path: localPath, 
        branches: ['main', 'master'] 
      });
      
      // 잠깐 지연 시뮬레이션
      await this.delay(100);

      this.dependencies.logger.info('Mock: Repository cloned successfully', { 
        repositoryUrl, 
        localPath, 
        clonedRepositories: Array.from(this.clonedRepositories) 
      });
    });
  }

  async fetch(localPath: string): Promise<void> {
    // 경로에서 repository ID 추출
    const repoId = path.basename(path.dirname(localPath));
    
    return this.dependencies.gitLockService.withLock(repoId, 'fetch', async () => {
      this.dependencies.logger.info('Mock: Fetching repository updates', { localPath });
      
      // 저장소가 clone되었는지 확인
      const repoIdFromPath = this.getRepoIdFromPath(localPath);
      if (!this.clonedRepositories.has(repoIdFromPath)) {
        throw new Error(`Repository not found: ${localPath}`);
      }
      
      // 잠깐 지연 시뮬레이션
      await this.delay(50);
      
      this.dependencies.logger.info('Mock: Repository fetched successfully', { localPath });
    });
  }

  async pullMainBranch(localPath: string): Promise<void> {
    // 경로에서 repository ID 추출
    const repoId = path.basename(path.dirname(localPath));
    
    return this.dependencies.gitLockService.withLock(repoId, 'pull', async () => {
      this.dependencies.logger.info('Mock: Pulling main branch updates', { localPath });
      
      // 저장소가 clone되었는지 확인
      const repoIdFromPath = this.getRepoIdFromPath(localPath);
      if (!this.clonedRepositories.has(repoIdFromPath)) {
        throw new Error(`Repository not found: ${localPath}`);
      }
      
      // 잠깐 지연 시뮬레이션
      await this.delay(50);
      
      this.dependencies.logger.info('Mock: Main branch pulled successfully', { localPath });
    });
  }

  async createWorktree(repoPath: string, branchName: string, worktreePath: string, baseBranch?: string): Promise<void> {
    // 경로에서 repository ID 추출
    const repoId = path.basename(repoPath);
    
    return this.dependencies.gitLockService.withLock(repoId, 'worktree', async () => {
      this.dependencies.logger.info('Mock: Creating git worktree', { repoPath, branchName, worktreePath, baseBranch });
      
      // 저장소가 존재하는지 확인
      const repoIdFromPath = this.getRepoIdFromPath(repoPath);
      if (!this.clonedRepositories.has(repoIdFromPath)) {
        throw new Error(`Repository not found: ${repoPath}`);
      }
      
      // Mock 환경에서도 실제 worktree 디렉토리 생성 (테스트를 위해)
      const fs = require('fs').promises;
      try {
        await fs.mkdir(worktreePath, { recursive: true });
        this.dependencies.logger.debug('Mock: Worktree directory created', { worktreePath });
      } catch (error) {
        this.dependencies.logger.warn('Mock: Failed to create worktree directory', { worktreePath, error });
        // 디렉토리 생성 실패는 워크트리 생성 자체의 실패로 간주하지 않음
      }
      
      // 워크트리 생성 시뮬레이션
      const worktreeId = `${repoIdFromPath}-${branchName}`;
      this.worktrees.set(worktreeId, { repoPath, branchName, worktreePath });
      
      // 브랜치를 저장소에 추가
      const repo = this.repositories.get(repoIdFromPath);
      if (repo && !repo.branches.includes(branchName)) {
        repo.branches.push(branchName);
      }
      
      // 잠깐 지연 시뮬레이션
      await this.delay(100);
      
      this.dependencies.logger.info('Mock: Git worktree created successfully', { repoPath, branchName, worktreePath });
    });
  }

  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    this.dependencies.logger.info('Mock: Removing git worktree', { repoPath, worktreePath });
    
    // Mock 환경에서도 실제 디렉토리 정리 (테스트를 위해)
    const fs = require('fs').promises;
    try {
      await fs.rm(worktreePath, { recursive: true, force: true });
      this.dependencies.logger.debug('Mock: Worktree directory removed', { worktreePath });
    } catch (error) {
      this.dependencies.logger.warn('Mock: Failed to remove worktree directory', { worktreePath, error });
      // 디렉토리 제거 실패는 워크트리 제거 자체의 실패로 간주하지 않음
    }
    
    // 워크트리 제거 시뮬레이션
    for (const [worktreeId, worktree] of this.worktrees.entries()) {
      if (worktree.repoPath === repoPath && worktree.worktreePath === worktreePath) {
        this.worktrees.delete(worktreeId);
        break;
      }
    }
    
    // 잠깐 지연 시뮬레이션
    await this.delay(50);
    
    this.dependencies.logger.info('Mock: Git worktree removed successfully', { repoPath, worktreePath });
  }

  async isValidRepository(path: string): Promise<boolean> {
    const repoId = this.getRepoIdFromPath(path);
    return this.clonedRepositories.has(repoId);
  }

  // 테스트용 헬퍼 메서드들
  getClonedRepositories(): string[] {
    return Array.from(this.clonedRepositories);
  }

  getWorktrees(): Array<{ repoPath: string; branchName: string; worktreePath: string }> {
    return Array.from(this.worktrees.values());
  }

  reset(): void {
    this.clonedRepositories.clear();
    this.repositories.clear();
    this.worktrees.clear();
  }

  private extractRepoIdFromUrl(repositoryUrl: string): string {
    // GitHub URL 패턴: https://github.com/owner/repo.git
    // SSH URL 패턴: git@github.com:owner/repo.git
    const match = repositoryUrl.match(/[:/]([^/]+\/[^/]+?)(\.git)?$/);
    if (match && match[1]) {
      return match[1];
    }
    
    // 기본값으로 URL의 마지막 부분 사용
    return repositoryUrl.split('/').pop()?.replace('.git', '') || 'unknown';
  }

  private getRepoIdFromPath(localPath: string): string {
    // 경로에서 저장소 이름 추출
    // 예: .test-workspace/repositories/test-owner_test-repo -> test-owner/test-repo
    const pathParts = localPath.split('/');
    const repoDir = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
    
    // _ 를 / 로 변환하여 owner/repo 형식으로 변환
    if (repoDir && repoDir.includes('_')) {
      return repoDir.replace('_', '/');
    }
    
    // 이미 owner/repo 형식이거나 단순 이름인 경우
    return repoDir || 'unknown';
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
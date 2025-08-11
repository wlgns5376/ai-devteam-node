import { GitServiceInterface } from '@/types/manager.types';
import { Logger } from '../../logger';

export class MockGitService implements GitServiceInterface {
  private clonedRepositories: Set<string> = new Set();
  private repositories: Map<string, { path: string; branches: string[] }> = new Map();
  private worktrees: Map<string, { repoPath: string; branchName: string; worktreePath: string }> = new Map();

  constructor(private readonly logger: Logger) {}

  async clone(repositoryUrl: string, localPath: string): Promise<void> {
    this.logger.info('Mock: Cloning repository', { repositoryUrl, localPath });
    
    // 실제 디렉토리 생성 없이 내부 상태만 업데이트
    const repoId = this.extractRepoIdFromUrl(repositoryUrl);
    this.clonedRepositories.add(repoId);
    this.repositories.set(repoId, { 
      path: localPath, 
      branches: ['main', 'master'] 
    });
    
    // 잠깐 지연 시뮬레이션
    await this.delay(100);
    
    this.logger.info('Mock: Repository cloned successfully', { repositoryUrl, localPath });
  }

  async fetch(localPath: string): Promise<void> {
    this.logger.info('Mock: Fetching repository updates', { localPath });
    
    // 저장소가 clone되었는지 확인
    const repoId = this.getRepoIdFromPath(localPath);
    if (!this.clonedRepositories.has(repoId)) {
      throw new Error(`Repository not found: ${localPath}`);
    }
    
    // 잠깐 지연 시뮬레이션
    await this.delay(50);
    
    this.logger.info('Mock: Repository fetched successfully', { localPath });
  }

  async pullMainBranch(localPath: string): Promise<void> {
    this.logger.info('Mock: Pulling main branch updates', { localPath });
    
    // 저장소가 clone되었는지 확인
    const repoId = this.getRepoIdFromPath(localPath);
    if (!this.clonedRepositories.has(repoId)) {
      throw new Error(`Repository not found: ${localPath}`);
    }
    
    // 잠깐 지연 시뮬레이션
    await this.delay(50);
    
    this.logger.info('Mock: Main branch pulled successfully', { localPath });
  }

  async createWorktree(repoPath: string, branchName: string, worktreePath: string): Promise<void> {
    this.logger.info('Mock: Creating git worktree', { repoPath, branchName, worktreePath });
    
    // 저장소가 존재하는지 확인
    const repoId = this.getRepoIdFromPath(repoPath);
    if (!this.clonedRepositories.has(repoId)) {
      throw new Error(`Repository not found: ${repoPath}`);
    }
    
    // 워크트리 생성 시뮬레이션
    const worktreeId = `${repoId}-${branchName}`;
    this.worktrees.set(worktreeId, { repoPath, branchName, worktreePath });
    
    // 브랜치를 저장소에 추가
    const repo = this.repositories.get(repoId);
    if (repo && !repo.branches.includes(branchName)) {
      repo.branches.push(branchName);
    }
    
    // 잠깐 지연 시뮬레이션
    await this.delay(100);
    
    this.logger.info('Mock: Git worktree created successfully', { repoPath, branchName, worktreePath });
  }

  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    this.logger.info('Mock: Removing git worktree', { repoPath, worktreePath });
    
    // 워크트리 제거 시뮬레이션
    for (const [worktreeId, worktree] of this.worktrees.entries()) {
      if (worktree.repoPath === repoPath && worktree.worktreePath === worktreePath) {
        this.worktrees.delete(worktreeId);
        break;
      }
    }
    
    // 잠깐 지연 시뮬레이션
    await this.delay(50);
    
    this.logger.info('Mock: Git worktree removed successfully', { repoPath, worktreePath });
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
    // 경로에서 저장소 이름 추출 (마지막 디렉토리명)
    return localPath.split('/').pop() || 'unknown';
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
import { 
  RepositoryManagerInterface,
  RepositoryState,
  ManagerServiceConfig,
  GitServiceInterface,
  ManagerError
} from '@/types/manager.types';
import { Logger } from '../logger';
import { StateManager } from '../state-manager';
import * as path from 'path';
import * as fs from 'fs/promises';

interface RepositoryManagerDependencies {
  readonly logger: Logger;
  readonly stateManager: StateManager;
  readonly gitService: GitServiceInterface;
}

export class RepositoryManager implements RepositoryManagerInterface {
  private errors: ManagerError[] = [];
  private repositoryCache: Map<string, { state: RepositoryState; cachedAt: Date }> = new Map();

  constructor(
    private readonly config: ManagerServiceConfig,
    private readonly dependencies: RepositoryManagerDependencies
  ) {}

  async ensureRepository(repositoryId: string): Promise<string> {
    try {
      this.dependencies.logger.info('Ensuring repository', { repositoryId });

      // 캐시 확인
      const cachedState = this.getCachedState(repositoryId);
      if (cachedState && cachedState.isCloned) {
        // 캐시가 만료되지 않았다면 fetch만 수행
        if (!this.isCacheExpired(repositoryId)) {
          this.dependencies.logger.debug('Using cached repository state', { 
            repositoryId,
            localPath: cachedState.localPath 
          });
          return cachedState.localPath;
        }

        // 캐시가 만료되었으면 fetch 수행
        await this.fetchRepository(repositoryId);
        return cachedState.localPath;
      }

      // 상태 확인
      const state = await this.getRepositoryState(repositoryId);
      
      if (state && state.isCloned) {
        // 이미 클론되어 있으면 최신화만
        await this.fetchRepository(repositoryId);
        return state.localPath;
      }

      // 클론되어 있지 않으면 새로 클론
      return await this.cloneRepository(repositoryId);

    } catch (error) {
      const managerError: ManagerError = {
        message: error instanceof Error ? error.message : 'Failed to ensure repository',
        code: 'REPOSITORY_ENSURE_ERROR',
        timestamp: new Date(),
        context: { repositoryId, error }
      };
      
      this.errors.push(managerError);
      this.dependencies.logger.error('Failed to ensure repository', { error: managerError });
      throw error;
    }
  }

  async cloneRepository(repositoryId: string): Promise<string> {
    try {
      this.dependencies.logger.info('Cloning repository', { repositoryId });

      // Repository URL 생성 (GitHub)
      const repositoryUrl = this.generateRepositoryUrl(repositoryId);
      
      // 로컬 경로 생성
      const localPath = this.generateLocalPath(repositoryId);
      
      // Git clone 실행
      await this.dependencies.gitService.clone(repositoryUrl, localPath);
      
      // 상태 저장
      const state: RepositoryState = {
        id: repositoryId,
        localPath,
        lastFetchAt: new Date(),
        isCloned: true,
        activeWorktrees: []
      };
      
      await this.dependencies.stateManager.saveRepositoryState(state);
      this.updateCache(repositoryId, state);
      
      this.dependencies.logger.info('Repository cloned successfully', { 
        repositoryId, 
        localPath 
      });
      
      return localPath;

    } catch (error) {
      const managerError: ManagerError = {
        message: error instanceof Error ? error.message : 'Repository clone failed',
        code: 'REPOSITORY_CLONE_ERROR',
        timestamp: new Date(),
        context: { repositoryId, error }
      };
      
      this.errors.push(managerError);
      this.dependencies.logger.error('Failed to clone repository', { error: managerError });
      throw error;
    }
  }

  async fetchRepository(repositoryId: string): Promise<void> {
    try {
      this.dependencies.logger.info('Fetching repository updates', { repositoryId });

      const state = await this.getRepositoryState(repositoryId);
      
      if (!state || !state.isCloned) {
        throw new Error(`Repository ${repositoryId} is not cloned`);
      }

      // Git fetch 실행
      await this.dependencies.gitService.fetch(state.localPath);
      
      // 상태 업데이트
      const updatedState: RepositoryState = {
        ...state,
        lastFetchAt: new Date()
      };
      
      await this.dependencies.stateManager.saveRepositoryState(updatedState);
      this.updateCache(repositoryId, updatedState);
      
      this.dependencies.logger.info('Repository fetched successfully', { 
        repositoryId,
        localPath: state.localPath 
      });

    } catch (error) {
      const managerError: ManagerError = {
        message: error instanceof Error ? error.message : 'Repository fetch failed',
        code: 'REPOSITORY_FETCH_ERROR',
        timestamp: new Date(),
        context: { repositoryId, error }
      };
      
      this.errors.push(managerError);
      this.dependencies.logger.error('Failed to fetch repository', { error: managerError });
      throw error;
    }
  }

  async getRepositoryState(repositoryId: string): Promise<RepositoryState | null> {
    // 캐시 확인
    const cached = this.getCachedState(repositoryId);
    if (cached && !this.isCacheExpired(repositoryId)) {
      return cached;
    }

    // StateManager에서 로드
    const state = await this.dependencies.stateManager.loadRepositoryState(repositoryId);
    
    if (state) {
      // 실제로 디렉토리가 존재하는지 확인
      const exists = await this.checkDirectoryExists(state.localPath);
      if (!exists) {
        // 디렉토리가 없으면 상태 초기화
        this.dependencies.logger.warn('Repository directory not found, resetting state', {
          repositoryId,
          localPath: state.localPath
        });
        await this.dependencies.stateManager.removeRepositoryState(repositoryId);
        this.repositoryCache.delete(repositoryId);
        return null;
      }

      // Git 저장소인지 확인
      const isValid = await this.dependencies.gitService.isValidRepository(state.localPath);
      if (!isValid) {
        // 유효한 Git 저장소가 아니면 상태 초기화
        this.dependencies.logger.warn('Invalid git repository, resetting state', {
          repositoryId,
          localPath: state.localPath
        });
        await this.dependencies.stateManager.removeRepositoryState(repositoryId);
        this.repositoryCache.delete(repositoryId);
        return null;
      }

      this.updateCache(repositoryId, state);
    }
    
    return state;
  }

  async isRepositoryCloned(repositoryId: string): Promise<boolean> {
    const state = await this.getRepositoryState(repositoryId);
    return state !== null && state.isCloned;
  }

  private generateLocalPath(repositoryId: string): string {
    // repositoryId가 'owner/repo' 형식이라고 가정
    const safeRepositoryId = repositoryId.replace('/', '_');
    return path.join(this.config.workspaceBasePath, '..', 'repositories', safeRepositoryId);
  }

  private getCachedState(repositoryId: string): RepositoryState | null {
    const cached = this.repositoryCache.get(repositoryId);
    return cached ? cached.state : null;
  }

  private isCacheExpired(repositoryId: string): boolean {
    const cached = this.repositoryCache.get(repositoryId);
    if (!cached) return true;
    
    const cacheAge = Date.now() - cached.cachedAt.getTime();
    return cacheAge > this.config.repositoryCacheTimeoutMs;
  }

  private updateCache(repositoryId: string, state: RepositoryState): void {
    this.repositoryCache.set(repositoryId, {
      state,
      cachedAt: new Date()
    });
  }

  private generateRepositoryUrl(repositoryId: string): string {
    // repositoryId를 GitHub URL로 변환 (owner/repo -> https://github.com/owner/repo.git)
    if (!repositoryId.includes('/')) {
      throw new Error(`Invalid repository ID format: ${repositoryId}. Expected format: owner/repo`);
    }
    return `https://github.com/${repositoryId}.git`;
  }

  private async checkDirectoryExists(dirPath: string): Promise<boolean> {
    try {
      await fs.access(dirPath);
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  // Worktree 관리를 위한 헬퍼 메서드
  async addWorktree(repositoryId: string, worktreePath: string): Promise<void> {
    const state = await this.getRepositoryState(repositoryId);
    if (!state) {
      throw new Error(`Repository ${repositoryId} not found`);
    }

    const updatedState: RepositoryState = {
      ...state,
      activeWorktrees: [...state.activeWorktrees, worktreePath]
    };

    await this.dependencies.stateManager.saveRepositoryState(updatedState);
    this.updateCache(repositoryId, updatedState);
  }

  async removeWorktree(repositoryId: string, worktreePath: string): Promise<void> {
    const state = await this.getRepositoryState(repositoryId);
    if (!state) {
      throw new Error(`Repository ${repositoryId} not found`);
    }

    const updatedState: RepositoryState = {
      ...state,
      activeWorktrees: state.activeWorktrees.filter(w => w !== worktreePath)
    };

    await this.dependencies.stateManager.saveRepositoryState(updatedState);
    this.updateCache(repositoryId, updatedState);
  }
}
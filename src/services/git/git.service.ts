import { GitServiceInterface } from '@/types/manager.types';
import { Logger } from '../logger';
import { GitLockService } from './git-lock.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

interface GitServiceDependencies {
  readonly logger: Logger;
  readonly gitOperationTimeoutMs: number;
  readonly gitLockService: GitLockService;
}

export class GitService implements GitServiceInterface {
  constructor(
    private readonly dependencies: GitServiceDependencies
  ) {}

  async clone(repositoryUrl: string, localPath: string): Promise<void> {
    // URL에서 repository ID 추출 (예: owner/repo)
    const repoId = this.extractRepoIdFromUrl(repositoryUrl);
    
    return this.dependencies.gitLockService.withLock(repoId, 'clone', async () => {
      try {
        this.dependencies.logger.info('Cloning repository', { 
          repositoryUrl, 
          localPath 
        });

        // 부모 디렉토리가 없으면 생성
        const parentDir = path.dirname(localPath);
        await fs.mkdir(parentDir, { recursive: true });

        // git clone 실행
        const { stdout, stderr } = await execAsync(
          `git clone "${repositoryUrl}" "${localPath}"`,
          {
            timeout: this.dependencies.gitOperationTimeoutMs
          }
        );

        if (stderr && !stderr.includes('Cloning into')) {
          this.dependencies.logger.warn('Git clone completed with warnings', { stderr });
        }

        this.dependencies.logger.info('Repository cloned successfully', { 
          repositoryUrl, 
          localPath,
          output: stdout
        });

      } catch (error) {
        const errorMessage = `Failed to clone repository: ${error instanceof Error ? error.message : String(error)}`;
        this.dependencies.logger.error('Git clone failed', { 
          repositoryUrl, 
          localPath, 
          error 
        });
        throw new Error(errorMessage);
      }
    });
  }

  async fetch(localPath: string): Promise<void> {
    // 경로에서 repository ID 추출
    const repoId = path.basename(path.dirname(localPath));
    
    return this.dependencies.gitLockService.withLock(repoId, 'fetch', async () => {
      try {
        this.dependencies.logger.info('Fetching repository updates', { localPath });

        // 유효한 저장소인지 먼저 확인
        const isValid = await this.isValidRepository(localPath);
        if (!isValid) {
          throw new Error(`Invalid repository path: ${localPath}`);
        }

        // git fetch 실행
        const { stdout, stderr } = await execAsync(
          'git fetch --all --prune',
          {
            cwd: localPath,
            timeout: this.dependencies.gitOperationTimeoutMs
          }
        );

        if (stderr && !stderr.includes('From ')) {
          this.dependencies.logger.warn('Git fetch completed with warnings', { stderr });
        }

        this.dependencies.logger.info('Repository fetched successfully', { 
          localPath,
          output: stdout || 'No output (already up to date)'
        });

      } catch (error) {
        const errorMessage = `Failed to fetch repository: ${error instanceof Error ? error.message : String(error)}`;
        this.dependencies.logger.error('Git fetch failed', { 
          localPath, 
          error 
        });
        throw new Error(errorMessage);
      }
    });
  }

  async createWorktree(repoPath: string, branchName: string, worktreePath: string): Promise<void> {
    // 경로에서 repository ID 추출
    const repoId = path.basename(repoPath);
    
    return this.dependencies.gitLockService.withLock(repoId, 'worktree', async () => {
      try {
        this.dependencies.logger.info('Creating git worktree', { 
          repoPath, 
          branchName, 
          worktreePath 
        });

        // 유효한 저장소인지 확인
        const isValid = await this.isValidRepository(repoPath);
        if (!isValid) {
          throw new Error(`Invalid repository path: ${repoPath}`);
        }

        // worktree 부모 디렉토리 생성
        const parentDir = path.dirname(worktreePath);
        await fs.mkdir(parentDir, { recursive: true });

        // 브랜치가 이미 존재하는지 확인
        const branchExists = await this.branchExists(repoPath, branchName);
        
        let command: string;
        if (branchExists) {
          // 기존 브랜치를 사용하여 worktree 생성
          command = `git worktree add "${worktreePath}" "${branchName}"`;
        } else {
          // 새 브랜치를 생성하며 worktree 추가
          command = `git worktree add -b "${branchName}" "${worktreePath}"`;
        }

        const { stdout, stderr } = await execAsync(
          command,
          {
            cwd: repoPath,
            timeout: this.dependencies.gitOperationTimeoutMs
          }
        );

        if (stderr && !stderr.includes('Preparing worktree')) {
          this.dependencies.logger.warn('Git worktree created with warnings', { stderr });
        }

        this.dependencies.logger.info('Git worktree created successfully', { 
          repoPath,
          branchName,
          worktreePath,
          output: stdout
        });

      } catch (error) {
        const errorMessage = `Failed to create git worktree: ${error instanceof Error ? error.message : String(error)}`;
        this.dependencies.logger.error('Git worktree creation failed', { 
          repoPath,
          branchName,
          worktreePath,
          error 
        });
        throw new Error(errorMessage);
      }
    });
  }

  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    try {
      this.dependencies.logger.info('Removing git worktree', { 
        repoPath, 
        worktreePath 
      });

      // git worktree remove 실행
      const { stdout, stderr } = await execAsync(
        `git worktree remove --force "${worktreePath}"`,
        {
          cwd: repoPath,
          timeout: this.dependencies.gitOperationTimeoutMs
        }
      );

      if (stderr) {
        this.dependencies.logger.warn('Git worktree removed with warnings', { stderr });
      }

      // worktree 디렉토리가 남아있다면 직접 삭제
      try {
        await fs.access(worktreePath);
        await fs.rm(worktreePath, { recursive: true, force: true });
        this.dependencies.logger.debug('Worktree directory removed manually', { worktreePath });
      } catch {
        // 디렉토리가 이미 없으면 무시
      }

      this.dependencies.logger.info('Git worktree removed successfully', { 
        repoPath,
        worktreePath,
        output: stdout
      });

    } catch (error) {
      // worktree가 이미 없는 경우는 성공으로 처리
      if (error instanceof Error && error.message.includes('is not a working tree')) {
        this.dependencies.logger.debug('Worktree already removed', { worktreePath });
        return;
      }

      const errorMessage = `Failed to remove git worktree: ${error instanceof Error ? error.message : String(error)}`;
      this.dependencies.logger.error('Git worktree removal failed', { 
        repoPath,
        worktreePath,
        error 
      });
      throw new Error(errorMessage);
    }
  }

  async isValidRepository(path: string): Promise<boolean> {
    try {
      // .git 디렉토리 또는 파일(worktree의 경우) 존재 확인
      const gitPath = `${path}/.git`;
      await fs.access(gitPath);

      // git status로 유효성 확인
      await execAsync('git status', { 
        cwd: path,
        timeout: 5000 
      });

      return true;
    } catch {
      return false;
    }
  }

  private async branchExists(repoPath: string, branchName: string): Promise<boolean> {
    try {
      // 로컬 및 원격 브랜치 확인
      const { stdout } = await execAsync(
        `git branch -a | grep -E "(^|/)${branchName}$"`,
        {
          cwd: repoPath,
          timeout: 5000
        }
      );

      return stdout.trim().length > 0;
    } catch {
      // grep이 일치하는 항목을 찾지 못하면 에러를 발생시키므로 false 반환
      return false;
    }
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
}
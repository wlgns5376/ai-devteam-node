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

  async pullMainBranch(localPath: string): Promise<void> {
    // 경로에서 repository ID 추출
    const repoId = path.basename(path.dirname(localPath));
    
    return this.dependencies.gitLockService.withLock(repoId, 'pull', async () => {
      try {
        this.dependencies.logger.info('Pulling main branch updates', { localPath });

        // 유효한 저장소인지 먼저 확인
        const isValid = await this.isValidRepository(localPath);
        if (!isValid) {
          throw new Error(`Invalid repository path: ${localPath}`);
        }

        // 현재 브랜치 확인
        const { stdout: currentBranch } = await execAsync(
          'git branch --show-current',
          {
            cwd: localPath,
            timeout: 5000
          }
        );

        const currentBranchName = currentBranch.trim();
        this.dependencies.logger.debug('Current branch', { currentBranch: currentBranchName, localPath });

        // main 브랜치로 체크아웃 (main 저장소인 경우)
        if (currentBranchName !== 'main' && currentBranchName !== 'master') {
          // 스테이징된 변경사항이 있는지 확인
          const { stdout: statusOutput } = await execAsync(
            'git status --porcelain',
            {
              cwd: localPath,
              timeout: 5000
            }
          );

          if (statusOutput.trim()) {
            this.dependencies.logger.warn('Working directory has uncommitted changes, stashing before pull', { 
              localPath,
              changes: statusOutput.trim()
            });
            
            // 변경사항 stash
            await execAsync('git stash', {
              cwd: localPath,
              timeout: this.dependencies.gitOperationTimeoutMs
            });
          }

          // main/master 브랜치로 체크아웃
          const mainBranch = await this.getMainBranchName(localPath);
          await execAsync(`git checkout ${mainBranch}`, {
            cwd: localPath,
            timeout: this.dependencies.gitOperationTimeoutMs
          });
        }

        // git pull 실행
        const { stdout, stderr } = await execAsync(
          'git pull --ff-only',
          {
            cwd: localPath,
            timeout: this.dependencies.gitOperationTimeoutMs
          }
        );

        if (stderr && !stderr.includes('From ') && !stderr.includes('Already up to date')) {
          this.dependencies.logger.warn('Git pull completed with warnings', { stderr });
        }

        this.dependencies.logger.info('Main branch pulled successfully', { 
          localPath,
          output: stdout || 'Already up to date'
        });

      } catch (error) {
        const errorMessage = `Failed to pull main branch: ${error instanceof Error ? error.message : String(error)}`;
        this.dependencies.logger.error('Git pull failed', { 
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

        // 이미 해당 경로에 worktree가 있는지 확인
        const existingWorktree = await this.findWorktreeByPath(repoPath, worktreePath);
        if (existingWorktree) {
          // 기존 워크트리가 유효한지 추가 검증
          const isWorktreeValid = await this.validateExistingWorktree(worktreePath);
          if (isWorktreeValid) {
            this.dependencies.logger.info('Valid worktree already exists at path, reusing', {
              repoPath,
              branchName,
              worktreePath,
              existingBranch: existingWorktree.branch
            });
            return;
          } else {
            this.dependencies.logger.warn('Invalid worktree found at path, removing and recreating', {
              repoPath,
              worktreePath,
              existingBranch: existingWorktree.branch
            });
            // 유효하지 않은 워크트리 제거 (디렉토리가 없어도 Git에서 제거)
            await this.removeWorktree(repoPath, worktreePath);
          }
        }

        // 등록되어 있지만 누락된 워크트리가 있을 수 있으므로 prune 실행
        try {
          await execAsync('git worktree prune', {
            cwd: repoPath,
            timeout: 10000
          });
          this.dependencies.logger.debug('Worktree prune completed', { repoPath });
        } catch (pruneError) {
          // prune 실패는 무시 (보통 정리할 것이 없음)
          this.dependencies.logger.debug('Worktree prune failed or nothing to prune', {
            repoPath,
            error: pruneError
          });
        }

        // 브랜치와 worktree 상태 확인
        const branchExists = await this.branchExists(repoPath, branchName);
        const branchInUse = branchExists ? await this.isBranchInWorktree(repoPath, branchName) : false;
        
        let command: string;
        try {
          if (branchExists && !branchInUse) {
            // 기존 브랜치를 사용하여 worktree 생성
            command = `git worktree add "${worktreePath}" "${branchName}"`;
          } else if (branchExists && branchInUse) {
            // 브랜치가 다른 worktree에서 사용 중인 경우 새 브랜치명 생성
            const newBranchName = await this.generateUniqueBranchName(repoPath, branchName);
            this.dependencies.logger.warn('Branch is in use, creating new branch', {
              originalBranch: branchName,
              newBranch: newBranchName
            });
            command = `git worktree add -b "${newBranchName}" "${worktreePath}"`;
          } else {
            // 새 브랜치를 생성하며 worktree 추가
            command = `git worktree add -b "${branchName}" "${worktreePath}"`;
          }

          const { stderr } = await execAsync(
            command,
            {
              cwd: repoPath,
              timeout: this.dependencies.gitOperationTimeoutMs
            }
          );

          if (stderr && !stderr.includes('Preparing worktree')) {
            this.dependencies.logger.warn('Git worktree created with warnings', { stderr });
          }
        } catch (worktreeError) {
          // worktree 생성 실패 시 기존 브랜치 정리 후 재시도
          if (branchExists && worktreeError instanceof Error && worktreeError.message.includes('already exists')) {
            this.dependencies.logger.warn('Branch conflict detected, attempting cleanup and retry', {
              branchName,
              error: worktreeError.message
            });
            
            await this.cleanupBranchAndRetry(repoPath, branchName, worktreePath);
          } else {
            throw worktreeError;
          }
        }

        this.dependencies.logger.info('Git worktree created successfully', { 
          repoPath,
          branchName,
          worktreePath
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

  /**
   * 경로별로 기존 worktree를 찾습니다.
   */
  private async findWorktreeByPath(repoPath: string, targetPath: string): Promise<{ path: string; branch: string } | null> {
    try {
      const { stdout } = await execAsync('git worktree list', { cwd: repoPath, timeout: 5000 });
      const worktrees = stdout.trim().split('\n').map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2 && parts[0] && parts[1]) {
          return { path: parts[0], branch: parts[1].replace(/[[\]]/g, '') };
        }
        return null;
      }).filter((wt): wt is { path: string; branch: string } => wt !== null);

      // 경로 정규화하여 비교 (절대경로로 변환)
      const normalizedTargetPath = path.resolve(targetPath);
      const foundWorktree = worktrees.find(wt => {
        const normalizedWorktreePath = path.resolve(wt.path);
        return normalizedWorktreePath === normalizedTargetPath;
      });

      if (foundWorktree) {
        this.dependencies.logger.debug('Found existing worktree', {
          targetPath,
          foundPath: foundWorktree.path,
          branch: foundWorktree.branch
        });
      }

      return foundWorktree || null;
    } catch (error) {
      this.dependencies.logger.debug('Failed to list worktrees', {
        repoPath,
        error
      });
      return null;
    }
  }

  /**
   * 브랜치가 현재 어떤 worktree에서 사용 중인지 확인합니다.
   */
  private async isBranchInWorktree(repoPath: string, branchName: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync('git worktree list', { cwd: repoPath, timeout: 5000 });
      return stdout.includes(`[${branchName}]`);
    } catch {
      return false;
    }
  }

  /**
   * 유니크한 브랜치명을 생성합니다.
   */
  private async generateUniqueBranchName(repoPath: string, baseName: string): Promise<string> {
    let counter = 1;
    let newName = `${baseName}-${counter}`;
    
    while (await this.branchExists(repoPath, newName)) {
      counter++;
      newName = `${baseName}-${counter}`;
    }
    
    return newName;
  }

  /**
   * 브랜치 충돌 정리 후 재시도합니다.
   */
  private async cleanupBranchAndRetry(repoPath: string, branchName: string, worktreePath: string): Promise<void> {
    try {
      // 브랜치가 worktree에서 사용 중인지 확인하고 정리
      const branchInUse = await this.isBranchInWorktree(repoPath, branchName);
      if (branchInUse) {
        // 사용 중인 worktree 제거
        await execAsync(`git worktree remove --force "${branchName}"`, { 
          cwd: repoPath, 
          timeout: 10000 
        }).catch(() => {
          // worktree 제거 실패는 무시 (이미 없을 수 있음)
        });
      }

      // 브랜치 삭제 시도
      await execAsync(`git branch -D "${branchName}"`, { 
        cwd: repoPath, 
        timeout: 5000 
      }).catch(() => {
        // 브랜치 삭제 실패는 무시 (이미 없을 수 있음)
      });

      // 새 브랜치로 worktree 생성
      const { stdout } = await execAsync(
        `git worktree add -b "${branchName}" "${worktreePath}"`,
        {
          cwd: repoPath,
          timeout: this.dependencies.gitOperationTimeoutMs
        }
      );

      this.dependencies.logger.info('Branch cleanup and worktree recreation successful', {
        branchName,
        worktreePath,
        output: stdout
      });
    } catch (cleanupError) {
      this.dependencies.logger.error('Failed to cleanup and retry worktree creation', {
        branchName,
        worktreePath,
        error: cleanupError
      });
      throw cleanupError;
    }
  }

  private async getMainBranchName(repoPath: string): Promise<string> {
    try {
      // 원격 저장소의 기본 브랜치 확인
      const { stdout } = await execAsync(
        'git symbolic-ref refs/remotes/origin/HEAD',
        {
          cwd: repoPath,
          timeout: 5000
        }
      );
      
      // refs/remotes/origin/main -> main 추출
      const branchName = stdout.trim().split('/').pop();
      return branchName || 'main';
    } catch {
      // 실패하면 main을 기본값으로 사용
      return 'main';
    }
  }

  /**
   * 기존 워크트리가 유효한지 검증합니다.
   */
  private async validateExistingWorktree(worktreePath: string): Promise<boolean> {
    try {
      // 디렉토리 존재 확인
      const stat = await fs.stat(worktreePath);
      if (!stat.isDirectory()) {
        return false;
      }

      // Git 워크트리 확인: .git 파일이 존재하고 적절한 내용을 가지는지 확인
      const gitPath = path.join(worktreePath, '.git');
      try {
        const gitContent = await fs.readFile(gitPath, 'utf-8');
        // Git worktree는 .git 파일에 "gitdir: ..." 형태로 저장됨
        const isWorktree = gitContent.trim().startsWith('gitdir:');
        
        if (!isWorktree) {
          this.dependencies.logger.debug('Path is not a valid worktree (.git file invalid)', {
            worktreePath,
            gitContent: gitContent.substring(0, 100)
          });
          return false;
        }

        // git status 명령으로 워크트리 상태 확인
        await execAsync('git status --porcelain', {
          cwd: worktreePath,
          timeout: 5000
        });

        this.dependencies.logger.debug('Existing worktree validation successful', {
          worktreePath
        });

        return true;
      } catch (gitError) {
        this.dependencies.logger.debug('Worktree git validation failed', {
          worktreePath,
          error: gitError
        });
        return false;
      }
    } catch (error) {
      this.dependencies.logger.debug('Worktree path validation failed', {
        worktreePath,
        error
      });
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
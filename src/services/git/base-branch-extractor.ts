import { WorkerTask } from '@/types/worker.types';
import { Logger } from '../logger';

interface BaseBranchExtractorDependencies {
  readonly logger: Logger;
  readonly githubService: {
    getRepositoryDefaultBranch(repositoryId: string): Promise<string>;
  };
}

export class BaseBranchExtractor {
  private readonly BASE_LABEL_PREFIX = 'base:';
  private readonly DEFAULT_BRANCH = 'main';

  constructor(
    private readonly dependencies: BaseBranchExtractorDependencies
  ) {}

  /**
   * 라벨 배열에서 base branch 정보를 추출합니다.
   * @param labels 라벨 배열
   * @returns 추출된 브랜치명 또는 null
   */
  extractFromLabels(labels: string[]): string | null {
    // 모든 base 라벨을 찾아서 여러 개 발견시 경고
    const baseLabels: { label: string; branchName: string }[] = [];
    
    for (const label of labels) {
      const lowerLabel = label.toLowerCase();
      if (lowerLabel.startsWith(this.BASE_LABEL_PREFIX)) {
        // base: 이후의 브랜치명 추출
        const branchName = label.substring(this.BASE_LABEL_PREFIX.length).trim();
        if (branchName) {
          baseLabels.push({ label, branchName });
        }
      }
    }

    if (baseLabels.length === 0) {
      return null;
    }

    if (baseLabels.length > 1) {
      this.dependencies.logger.warn('Multiple base branch labels found. Using the first one.', {
        baseLabels,
        selectedBranch: baseLabels[0]?.branchName
      });
    }

    const selected = baseLabels[0]!; // 이전에 길이 체크를 했으므로 안전함
    
    this.dependencies.logger.debug('Found base branch label', { 
      label: selected.label, 
      branchName: selected.branchName 
    });
    
    return selected.branchName;
  }

  /**
   * Repository의 기본 브랜치를 가져옵니다.
   * @param repositoryId Repository ID (예: owner/repo)
   * @returns 기본 브랜치명 또는 실패시 null
   */
  async getRepositoryDefault(repositoryId: string): Promise<string | null> {
    try {
      const defaultBranch = await this.dependencies.githubService.getRepositoryDefaultBranch(repositoryId);
      this.dependencies.logger.debug('Retrieved repository default branch', { 
        repositoryId, 
        defaultBranch 
      });
      return defaultBranch;
    } catch (error) {
      this.dependencies.logger.error('Failed to get repository default branch', {
        repositoryId,
        error
      });
      return null;
    }
  }

  /**
   * WorkerTask에서 base branch를 추출합니다.
   * 폴백 전략:
   * 1. Issue 라벨에서 base:브랜치명 추출
   * 2. Repository 기본 브랜치 (GitHub API)
   * 3. main 브랜치 (하드코딩)
   * 
   * @param task WorkerTask
   * @returns base branch명
   */
  async extractBaseBranch(task: WorkerTask): Promise<string> {
    // 1. 라벨에서 추출 시도
    if (task.boardItem?.labels) {
      const branchFromLabel = this.extractFromLabels(task.boardItem.labels);
      if (branchFromLabel) {
        this.dependencies.logger.info('Extracted base branch from labels', {
          taskId: task.taskId,
          baseBranch: branchFromLabel,
          labels: task.boardItem.labels
        });
        return branchFromLabel;
      }
    }

    // 2. Repository 기본 브랜치 사용
    const repoDefaultBranch = await this.getRepositoryDefault(task.repositoryId);
    if (repoDefaultBranch) {
      this.dependencies.logger.info('Using repository default branch as base branch', {
        taskId: task.taskId,
        baseBranch: repoDefaultBranch,
        repositoryId: task.repositoryId
      });
      return repoDefaultBranch;
    }

    // 3. 'main' 브랜치로 폴백
    this.dependencies.logger.info('Using "main" as final fallback branch', {
      taskId: task.taskId,
      baseBranch: this.DEFAULT_BRANCH,
      repositoryId: task.repositoryId
    });
    return this.DEFAULT_BRANCH;
  }
}
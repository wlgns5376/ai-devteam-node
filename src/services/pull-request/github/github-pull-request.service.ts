import { Octokit } from '@octokit/rest';
import { 
  PullRequest, 
  PullRequestService, 
  PullRequestState, 
  PullRequestReview, 
  PullRequestComment, 
  ReviewState 
} from '../../../types';
import { Logger } from '../../logger';

export interface GitHubPullRequestConfig {
  readonly token: string;
  readonly baseUrl?: string;
}

export class GitHubPullRequestError extends Error {
  constructor(
    message: string,
    public readonly repoId?: string,
    public readonly prNumber?: number,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'GitHubPullRequestError';
  }
}

export class GitHubPullRequestService implements PullRequestService {
  private readonly octokit: Octokit;
  private readonly logger: Logger;

  constructor(config: GitHubPullRequestConfig, logger?: Logger) {
    this.octokit = new Octokit({
      auth: config.token,
      baseUrl: config.baseUrl || 'https://api.github.com'
    });
    this.logger = logger || Logger.createConsoleLogger();
  }

  async getPullRequest(repoId: string, prNumber: number): Promise<PullRequest> {
    try {
      const { owner, repo } = this.parseRepoId(repoId);
      
      this.logger.debug('Getting pull request', { owner, repo, prNumber });

      const { data: pr } = await this.octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber
      });

      // 리뷰 상태 확인
      const isApproved = await this.isApproved(repoId, prNumber);
      const reviews = await this.getReviews(repoId, prNumber);
      const reviewState = this.determineReviewState(reviews);

      return this.mapGitHubPullRequestToInterface(pr, isApproved, reviewState);
    } catch (error) {
      this.logger.error('Failed to get pull request', {
        repoId,
        prNumber,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw new GitHubPullRequestError(
        `Failed to get pull request ${prNumber}`,
        repoId,
        prNumber,
        error as Error
      );
    }
  }

  async listPullRequests(repoId: string, status?: PullRequestState): Promise<ReadonlyArray<PullRequest>> {
    try {
      const { owner, repo } = this.parseRepoId(repoId);
      
      this.logger.debug('Listing pull requests', { owner, repo, status });

      // GitHub API 상태 매핑
      let state: 'open' | 'closed' | 'all' = 'all';
      if (status === PullRequestState.OPEN || status === PullRequestState.DRAFT) {
        state = 'open';
      } else if (status === PullRequestState.CLOSED || status === PullRequestState.MERGED) {
        state = 'closed';
      }

      const { data: prs } = await this.octokit.rest.pulls.list({
        owner,
        repo,
        state,
        sort: 'updated',
        direction: 'desc',
        per_page: 100
      });

      const pullRequests: PullRequest[] = [];

      for (const pr of prs) {
        // 요청된 상태와 일치하는지 확인
        const prState = this.mapGitHubStateToPullRequestState(pr);
        if (status && prState !== status) {
          continue;
        }

        const isApproved = await this.isApproved(repoId, pr.number);
        const reviews = await this.getReviews(repoId, pr.number);
        const reviewState = this.determineReviewState(reviews);

        pullRequests.push(this.mapGitHubPullRequestToInterface(pr, isApproved, reviewState));
      }

      this.logger.debug('Listed pull requests', {
        repoId,
        status,
        count: pullRequests.length
      });

      return pullRequests;
    } catch (error) {
      this.logger.error('Failed to list pull requests', {
        repoId,
        status,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw new GitHubPullRequestError(
        'Failed to list pull requests',
        repoId,
        undefined,
        error as Error
      );
    }
  }

  async isApproved(repoId: string, prNumber: number): Promise<boolean> {
    try {
      const reviews = await this.getReviews(repoId, prNumber);
      
      // 최신 리뷰 상태를 사용자별로 확인
      const latestReviewsByUser = new Map<string, PullRequestReview>();
      
      for (const review of [...reviews].reverse()) { // 최신순으로 정렬
        if (!latestReviewsByUser.has(review.reviewer)) {
          latestReviewsByUser.set(review.reviewer, review);
        }
      }

      // 최소 한 명의 승인이 있고, 요청된 변경사항이 없어야 함
      const hasApproval = Array.from(latestReviewsByUser.values())
        .some(review => review.state === ReviewState.APPROVED);
      
      const hasChangesRequested = Array.from(latestReviewsByUser.values())
        .some(review => review.state === ReviewState.CHANGES_REQUESTED);

      return hasApproval && !hasChangesRequested;
    } catch (error) {
      this.logger.error('Failed to check approval status', {
        repoId,
        prNumber,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  async getReviews(repoId: string, prNumber: number): Promise<ReadonlyArray<PullRequestReview>> {
    try {
      const { owner, repo } = this.parseRepoId(repoId);
      
      const { data: reviews } = await this.octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: prNumber
      });

      return reviews.map(review => ({
        id: review.id.toString(),
        state: this.mapGitHubReviewStateToReviewState(review.state),
        comment: review.body || '',
        reviewer: review.user?.login || 'unknown',
        submittedAt: new Date(review.submitted_at || new Date().toISOString())
      }));
    } catch (error) {
      this.logger.error('Failed to get reviews', {
        repoId,
        prNumber,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw new GitHubPullRequestError(
        `Failed to get reviews for PR ${prNumber}`,
        repoId,
        prNumber,
        error as Error
      );
    }
  }

  async getComments(repoId: string, prNumber: number): Promise<ReadonlyArray<PullRequestComment>> {
    try {
      const { owner, repo } = this.parseRepoId(repoId);
      
      // Issue comments (PR 전체 코멘트)
      const { data: issueComments } = await this.octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: prNumber
      });

      // Review comments (코드 라인별 코멘트)
      const { data: reviewComments } = await this.octokit.rest.pulls.listReviewComments({
        owner,
        repo,
        pull_number: prNumber
      });

      // PR Reviews (리뷰 전체 코멘트)
      const { data: reviews } = await this.octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: prNumber
      });

      const comments: PullRequestComment[] = [];

      // Issue comments 추가
      for (const comment of issueComments) {
        comments.push({
          id: comment.id.toString(),
          content: comment.body || '',
          author: comment.user?.login || 'unknown',
          createdAt: new Date(comment.created_at),
          updatedAt: comment.updated_at ? new Date(comment.updated_at) : undefined,
          isProcessed: false, // 기본값
          metadata: {
            type: 'issue_comment',
            url: comment.html_url
          }
        });
      }

      // Review comments 추가
      for (const comment of reviewComments) {
        comments.push({
          id: comment.id.toString(),
          content: comment.body || '',
          author: comment.user?.login || 'unknown',
          createdAt: new Date(comment.created_at),
          updatedAt: comment.updated_at ? new Date(comment.updated_at) : undefined,
          isProcessed: false, // 기본값
          metadata: {
            type: 'review_comment',
            path: comment.path,
            line: comment.line,
            url: comment.html_url
          }
        });
      }

      // PR Review body comments 추가
      for (const review of reviews) {
        // 리뷰에 body가 있는 경우에만 추가
        if (review.body && review.body.trim()) {
          comments.push({
            id: `review-${review.id}`,
            content: review.body,
            author: review.user?.login || 'unknown',
            createdAt: new Date(review.submitted_at || new Date().toISOString()),
            updatedAt: undefined, // 리뷰는 수정되지 않음
            isProcessed: false, // 기본값
            metadata: {
              type: 'review_body',
              reviewState: review.state,
              url: review.html_url
            }
          });
        }
      }

      // 시간순 정렬
      comments.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      return comments;
    } catch (error) {
      this.logger.error('Failed to get comments', {
        repoId,
        prNumber,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw new GitHubPullRequestError(
        `Failed to get comments for PR ${prNumber}`,
        repoId,
        prNumber,
        error as Error
      );
    }
  }

  async getNewComments(repoId: string, prNumber: number, since: Date): Promise<ReadonlyArray<PullRequestComment>> {
    try {
      const allComments = await this.getComments(repoId, prNumber);
      
      return allComments.filter(comment => 
        comment.createdAt > since || 
        (comment.updatedAt && comment.updatedAt > since)
      );
    } catch (error) {
      this.logger.error('Failed to get new comments', {
        repoId,
        prNumber,
        since,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw new GitHubPullRequestError(
        `Failed to get new comments for PR ${prNumber}`,
        repoId,
        prNumber,
        error as Error
      );
    }
  }

  async markCommentsAsProcessed(commentIds: string[]): Promise<void> {
    // GitHub API에는 코멘트 처리 상태를 직접 저장할 수 없으므로,
    // 실제 구현에서는 로컬 상태 관리나 별도 저장소를 사용해야 함
    this.logger.debug('Marking comments as processed', { commentIds });
    
    // TODO: StateManager나 별도 저장소에 처리된 코멘트 ID 저장
    // 현재는 로깅만 수행
  }

  private parseRepoId(repoId: string): { owner: string; repo: string } {
    const parts = repoId.split('/');
    if (parts.length !== 2) {
      throw new GitHubPullRequestError(`Invalid repository ID format: ${repoId}. Expected 'owner/repo'`);
    }
    return { owner: parts[0] || '', repo: parts[1] || '' };
  }

  private mapGitHubPullRequestToInterface(
    pr: any, 
    isApproved: boolean, 
    reviewState: ReviewState
  ): PullRequest {
    return {
      id: pr.number,
      title: pr.title,
      description: pr.body || '',
      url: pr.html_url || '',
      status: this.mapGitHubStateToPullRequestState(pr),
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref,
      author: pr.user?.login || 'unknown',
      createdAt: new Date(pr.created_at),
      updatedAt: new Date(pr.updated_at),
      isApproved,
      reviewState
    };
  }

  private mapGitHubStateToPullRequestState(pr: any): PullRequestState {
    if (pr.merged_at) {
      return PullRequestState.MERGED;
    }
    if (pr.draft) {
      return PullRequestState.DRAFT;
    }
    if (pr.state === 'open') {
      return PullRequestState.OPEN;
    }
    return PullRequestState.CLOSED;
  }

  private mapGitHubReviewStateToReviewState(state: string): ReviewState {
    switch (state) {
      case 'APPROVED':
        return ReviewState.APPROVED;
      case 'CHANGES_REQUESTED':
        return ReviewState.CHANGES_REQUESTED;
      case 'COMMENTED':
        return ReviewState.COMMENTED;
      default:
        return ReviewState.COMMENTED;
    }
  }

  private determineReviewState(reviews: ReadonlyArray<PullRequestReview>): ReviewState {
    if (reviews.length === 0) {
      return ReviewState.COMMENTED;
    }

    // 최신 리뷰들의 상태를 확인
    const latestReviewsByUser = new Map<string, ReviewState>();
    
    for (const review of [...reviews].reverse()) {
      if (!latestReviewsByUser.has(review.reviewer)) {
        latestReviewsByUser.set(review.reviewer, review.state);
      }
    }

    const states = Array.from(latestReviewsByUser.values());
    
    // 변경 요청이 있으면 우선
    if (states.includes(ReviewState.CHANGES_REQUESTED)) {
      return ReviewState.CHANGES_REQUESTED;
    }
    
    // 승인이 있으면 승인
    if (states.includes(ReviewState.APPROVED)) {
      return ReviewState.APPROVED;
    }
    
    return ReviewState.COMMENTED;
  }
}
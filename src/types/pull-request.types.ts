export interface PullRequest {
  readonly id: number;
  readonly title: string;
  readonly description: string;
  readonly url?: string | undefined;
  readonly status: PullRequestState;  
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly author: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly isApproved?: boolean;
  readonly reviewState?: ReviewState;
}

export enum PullRequestState {
  OPEN = 'open',
  CLOSED = 'closed',
  MERGED = 'merged',
  DRAFT = 'draft'
}

export interface PullRequestReview {
  readonly id: string;
  readonly state: ReviewState;
  readonly comment: string;
  readonly reviewer: string;
  readonly submittedAt: Date;
}

export enum ReviewState {
  APPROVED = 'approved',
  CHANGES_REQUESTED = 'changes_requested',
  COMMENTED = 'commented'
}

export interface PullRequestComment {
  readonly id: string;
  readonly content: string;
  readonly author: string;
  readonly createdAt: Date;
  readonly updatedAt?: Date | undefined;
  readonly isProcessed?: boolean | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface PullRequestService {
  // 조회 기능
  getPullRequest(repoId: string, prNumber: number): Promise<PullRequest>;
  listPullRequests(repoId: string, status?: PullRequestState): Promise<ReadonlyArray<PullRequest>>;
  
  // 승인 상태 확인 (Planner가 사용)
  isApproved(repoId: string, prNumber: number): Promise<boolean>;
  getReviews(repoId: string, prNumber: number): Promise<ReadonlyArray<PullRequestReview>>;
  
  // 코멘트 조회 (Planner가 사용)
  getComments(repoId: string, prNumber: number): Promise<ReadonlyArray<PullRequestComment>>;
  getNewComments(repoId: string, prNumber: number, since: Date): Promise<ReadonlyArray<PullRequestComment>>;
  markCommentsAsProcessed(commentIds: string[]): Promise<void>;
}
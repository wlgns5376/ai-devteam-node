export interface PullRequest {
  readonly id: number;
  readonly title: string;
  readonly description: string;
  readonly url?: string | undefined;
  readonly status: string;  
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly author: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
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

export interface CreatePullRequestData {
  readonly title: string;
  readonly description: string;
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly author: string;
}

export interface PullRequestService {
  getPullRequest(repoId: string, prNumber: number): Promise<PullRequest>;
  listPullRequests(repoId: string, status?: string): Promise<ReadonlyArray<PullRequest>>;
  createPullRequest(repoId: string, data: CreatePullRequestData): Promise<PullRequest>;
  updatePullRequestStatus(repoId: string, prNumber: number, status: string): Promise<PullRequest>;
  addComment(repoId: string, prNumber: number, content: string, author: string): Promise<PullRequestComment>;
  getComments(repoId: string, prNumber: number): Promise<ReadonlyArray<PullRequestComment>>;
  getNewComments(repoId: string, prNumber: number, since: Date): Promise<ReadonlyArray<PullRequestComment>>;
  markCommentsAsProcessed(commentIds: string[]): Promise<void>;
}
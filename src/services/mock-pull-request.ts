import { PullRequest, PullRequestService, PullRequestComment, PullRequestReview, PullRequestState, ReviewState } from '../types';

export class MockPullRequestService implements PullRequestService {
  private pullRequests: Map<string, Map<number, PullRequest>> = new Map();
  private comments: Map<string, PullRequestComment[]> = new Map();
  private reviews: Map<string, PullRequestReview[]> = new Map();
  private processedComments: Set<string> = new Set();

  constructor() {
    this.initializeMockData();
  }

  async getPullRequest(repoId: string, prNumber: number): Promise<PullRequest> {
    const repoPrs = this.pullRequests.get(repoId);
    if (!repoPrs) {
      throw new Error(`Pull request not found: ${repoId}/${prNumber}`);
    }

    const pr = repoPrs.get(prNumber);
    if (!pr) {
      throw new Error(`Pull request not found: ${repoId}/${prNumber}`);
    }

    // 승인 상태 업데이트
    const isApproved = await this.isApproved(repoId, prNumber);
    const reviews = await this.getReviews(repoId, prNumber);
    const reviewState = this.determineReviewState(reviews);

    return {
      ...pr,
      isApproved,
      reviewState
    };
  }

  async listPullRequests(repoId: string, status?: PullRequestState): Promise<ReadonlyArray<PullRequest>> {
    const repoPrs = this.pullRequests.get(repoId);
    if (!repoPrs) {
      return [];
    }

    let prs = Array.from(repoPrs.values());
    
    if (status) {
      prs = prs.filter(pr => pr.status === status);
    }

    // 승인 상태 업데이트
    const updatedPrs: PullRequest[] = [];
    for (const pr of prs) {
      const isApproved = await this.isApproved(repoId, pr.id);
      const reviews = await this.getReviews(repoId, pr.id);
      const reviewState = this.determineReviewState(reviews);
      
      updatedPrs.push({
        ...pr,
        isApproved,
        reviewState
      });
    }

    return updatedPrs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async isApproved(repoId: string, prNumber: number): Promise<boolean> {
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
  }

  async getReviews(repoId: string, prNumber: number): Promise<ReadonlyArray<PullRequestReview>> {
    const key = `${repoId}/${prNumber}`;
    return this.reviews.get(key) || [];
  }

  async getComments(repoId: string, prNumber: number): Promise<ReadonlyArray<PullRequestComment>> {
    const key = `${repoId}/${prNumber}`;
    const comments = this.comments.get(key) || [];
    
    return comments.map(comment => ({
      ...comment,
      isProcessed: this.processedComments.has(comment.id)
    }));
  }

  async getNewComments(repoId: string, prNumber: number, since: Date): Promise<ReadonlyArray<PullRequestComment>> {
    const allComments = await this.getComments(repoId, prNumber);
    
    return allComments.filter(comment => 
      comment.createdAt > since || 
      (comment.updatedAt && comment.updatedAt > since)
    );
  }

  async markCommentsAsProcessed(commentIds: string[]): Promise<void> {
    for (const id of commentIds) {
      this.processedComments.add(id);
    }
  }

  private initializeMockData(): void {
    // Mock repository
    const repoId = 'wlgns5376/ai-devteam-test';
    
    // Mock Pull Requests
    const mockPRs = new Map<number, PullRequest>();
    
    mockPRs.set(1, {
      id: 1,
      title: 'Add authentication system',
      description: 'Implement JWT-based authentication with login/logout functionality',
      url: 'https://github.com/wlgns5376/ai-devteam-test/pull/1',
      status: PullRequestState.OPEN,
      sourceBranch: 'feature/auth',
      targetBranch: 'main',
      author: 'ai-developer',
      createdAt: new Date('2024-01-01T10:00:00Z'),
      updatedAt: new Date('2024-01-02T15:30:00Z'),
      isApproved: false,
      reviewState: ReviewState.CHANGES_REQUESTED
    });

    mockPRs.set(2, {
      id: 2,
      title: 'Fix database connection pooling',
      description: 'Resolve connection leak issues in production',
      url: 'https://github.com/wlgns5376/ai-devteam-test/pull/2',
      status: PullRequestState.MERGED,
      sourceBranch: 'fix/db-connection',
      targetBranch: 'main',
      author: 'ai-developer',
      createdAt: new Date('2024-01-03T09:00:00Z'),
      updatedAt: new Date('2024-01-04T11:00:00Z'),
      isApproved: true,
      reviewState: ReviewState.APPROVED
    });

    mockPRs.set(3, {
      id: 3,
      title: 'Update documentation',
      description: 'Add API documentation and usage examples',
      url: 'https://github.com/wlgns5376/ai-devteam-test/pull/3',
      status: PullRequestState.OPEN,
      sourceBranch: 'docs/api-docs',
      targetBranch: 'main',
      author: 'ai-developer',
      createdAt: new Date('2024-01-05T14:00:00Z'),
      updatedAt: new Date('2024-01-05T16:30:00Z'),
      isApproved: true,
      reviewState: ReviewState.APPROVED
    });

    this.pullRequests.set(repoId, mockPRs);

    // Mock Reviews
    this.reviews.set(`${repoId}/1`, [
      {
        id: 'review-1-1',
        state: ReviewState.CHANGES_REQUESTED,
        comment: 'Please add input validation for the login form',
        reviewer: 'reviewer1',
        submittedAt: new Date('2024-01-02T11:00:00Z')
      }
    ]);

    this.reviews.set(`${repoId}/2`, [
      {
        id: 'review-2-1',
        state: ReviewState.APPROVED,
        comment: 'LGTM! Good fix for the connection pooling issue.',
        reviewer: 'reviewer1',
        submittedAt: new Date('2024-01-04T10:30:00Z')
      }
    ]);

    this.reviews.set(`${repoId}/3`, [
      {
        id: 'review-3-1',
        state: ReviewState.APPROVED,
        comment: 'Documentation looks comprehensive. Approving.',
        reviewer: 'reviewer2',
        submittedAt: new Date('2024-01-05T16:00:00Z')
      }
    ]);

    // Mock Comments
    this.comments.set(`${repoId}/1`, [
      {
        id: 'comment-1-1',
        content: 'Could you also add unit tests for the authentication endpoints?',
        author: 'reviewer1',
        createdAt: new Date('2024-01-02T12:00:00Z'),
        isProcessed: false,
        metadata: { type: 'review_feedback' }
      },
      {
        id: 'comment-1-2',
        content: 'I\'ll add the unit tests in the next commit.',
        author: 'ai-developer',
        createdAt: new Date('2024-01-02T15:00:00Z'),
        isProcessed: false,
        metadata: { type: 'developer_response' }
      }
    ]);

    this.comments.set(`${repoId}/3`, [
      {
        id: 'comment-3-1',
        content: 'The API examples are very helpful!',
        author: 'reviewer2',
        createdAt: new Date('2024-01-05T15:30:00Z'),
        isProcessed: false,
        metadata: { type: 'positive_feedback' }
      }
    ]);
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
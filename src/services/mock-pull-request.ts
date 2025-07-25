import { PullRequest, PullRequestService, PullRequestComment, CreatePullRequestData } from '@/types';

export class MockPullRequestService implements PullRequestService {
  private pullRequests: Map<string, Map<number, PullRequest>> = new Map();
  private comments: Map<string, PullRequestComment[]> = new Map();
  private nextPrId: Map<string, number> = new Map();

  constructor() {
    this.initializeMockData();
  }

  async getPullRequest(repoId: string, prNumber: number): Promise<PullRequest> {
    const repoPrs = this.pullRequests.get(repoId);
    if (!repoPrs) {
      throw new Error(`Pull request not found: ${repoId}/${prNumber}`);
    }

    let pr = repoPrs.get(prNumber);
    if (!pr) {
      throw new Error(`Pull request not found: ${repoId}/${prNumber}`);
    }

    // 자동 병합 로직: PR이 생성된 지 30초 이상 지나고 'open' 상태면 'merged'로 변경
    const now = new Date();
    const timeSinceCreation = now.getTime() - pr.createdAt.getTime();
    const autoMergeDelayMs = 30000; // 30초

    console.log(`🔍 PR Check: ${repoId}/${prNumber} - Status: ${pr.status}, Time since creation: ${timeSinceCreation}ms (needs ${autoMergeDelayMs}ms)`);

    if (pr.status === 'open' && timeSinceCreation > autoMergeDelayMs) {
      const mergedPr: PullRequest = {
        ...pr,
        status: 'merged',
        updatedAt: now
      };
      
      repoPrs.set(prNumber, mergedPr);
      console.log(`🔄 Auto-merged PR: ${repoId}/${prNumber} (${pr.title})`);
      pr = mergedPr;
    }

    return pr;
  }

  async listPullRequests(repoId: string, status?: string): Promise<ReadonlyArray<PullRequest>> {
    const repoPrs = this.pullRequests.get(repoId);
    if (!repoPrs) {
      // 동적으로 레포지토리 생성
      this.initializeRepo(repoId);
      return this.listPullRequests(repoId, status);
    }

    let prs = Array.from(repoPrs.values());
    
    if (status) {
      prs = prs.filter(pr => pr.status === status);
    }

    return [...prs];
  }

  async createPullRequest(repoId: string, data: CreatePullRequestData): Promise<PullRequest> {
    // 레포지토리가 없으면 생성
    if (!this.pullRequests.has(repoId)) {
      this.initializeRepo(repoId);
    }

    const repoPrs = this.pullRequests.get(repoId)!;
    const nextId = this.nextPrId.get(repoId) || 1;
    
    const newPr: PullRequest = {
      id: nextId,
      title: data.title,
      description: data.description,
      url: `https://github.com/${repoId}/pull/${nextId}`,
      status: 'open',
      sourceBranch: data.sourceBranch,
      targetBranch: data.targetBranch,
      author: data.author,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    repoPrs.set(nextId, newPr);
    this.nextPrId.set(repoId, nextId + 1);

    // 빈 코멘트 배열 초기화
    this.comments.set(`${repoId}/${nextId}`, []);

    return newPr;
  }

  async updatePullRequestStatus(repoId: string, prNumber: number, status: string): Promise<PullRequest> {
    const pr = await this.getPullRequest(repoId, prNumber);
    
    const updatedPr: PullRequest = {
      id: pr.id,
      title: pr.title,
      description: pr.description,
      url: pr.url,
      status,
      sourceBranch: pr.sourceBranch,
      targetBranch: pr.targetBranch,
      author: pr.author,
      createdAt: pr.createdAt,
      updatedAt: new Date()
    };

    const repoPrs = this.pullRequests.get(repoId)!;
    repoPrs.set(prNumber, updatedPr);

    return updatedPr;
  }

  async addComment(repoId: string, prNumber: number, content: string, author: string): Promise<PullRequestComment> {
    // PR 존재 확인
    await this.getPullRequest(repoId, prNumber);

    const commentKey = `${repoId}/${prNumber}`;
    const existingComments = this.comments.get(commentKey) || [];
    
    const newComment: PullRequestComment = {
      id: `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content,
      author,
      createdAt: new Date(),
      isProcessed: false
    };

    existingComments.push(newComment);
    this.comments.set(commentKey, existingComments);

    return newComment;
  }

  async getComments(repoId: string, prNumber: number): Promise<ReadonlyArray<PullRequestComment>> {
    // PR 존재 확인
    await this.getPullRequest(repoId, prNumber);

    const commentKey = `${repoId}/${prNumber}`;
    const comments = this.comments.get(commentKey) || [];
    
    return [...comments];
  }

  async getNewComments(repoId: string, prNumber: number, since: Date): Promise<ReadonlyArray<PullRequestComment>> {
    // PR 존재 확인
    await this.getPullRequest(repoId, prNumber);

    const commentKey = `${repoId}/${prNumber}`;
    const comments = this.comments.get(commentKey) || [];
    
    // since 이후의 코멘트만 필터링하고 처리되지 않은 것만 반환
    return comments.filter(comment => 
      comment.createdAt > since && !comment.isProcessed
    );
  }

  async markCommentsAsProcessed(commentIds: string[]): Promise<void> {
    // 모든 코멘트에서 해당 ID들을 찾아서 처리됨으로 표시
    for (const [commentKey, comments] of this.comments.entries()) {
      for (let i = 0; i < comments.length; i++) {
        const comment = comments[i];
        if (comment && commentIds.includes(comment.id)) {
          const updatedComment: PullRequestComment = {
            id: comment.id,
            content: comment.content,
            author: comment.author,
            createdAt: comment.createdAt,
            updatedAt: comment.updatedAt,
            isProcessed: true,
            metadata: comment.metadata
          };
          comments[i] = updatedComment;
        }
      }
    }
  }

  private initializeMockData(): void {
    this.initializeRepo('repo-1');
    this.initializeRepo('test-repo');
    this.initializeRepo('example/test-repo');
    this.initializeRepo('example/ai-devteam');
  }

  private initializeRepo(repoId: string): void {
    const repoPrs = new Map<number, PullRequest>();
    const baseDate = new Date();

    // 기본 PR들 생성
    const mockPrs: PullRequest[] = [
      {
        id: 1,
        title: 'Add user authentication system',
        description: 'This PR implements JWT-based authentication with login/logout functionality',
        url: `https://github.com/example/${repoId}/pull/1`,
        status: 'open',
        sourceBranch: 'feature/auth-system',
        targetBranch: 'main',
        author: 'claude-dev',
        createdAt: new Date(baseDate.getTime() - 2 * 24 * 60 * 60 * 1000), // 2일 전
        updatedAt: new Date(baseDate.getTime() - 4 * 60 * 60 * 1000) // 4시간 전
      },
      {
        id: 2,
        title: 'Fix database connection pool',
        description: 'Resolves connection pool exhaustion issues under high load',
        url: `https://github.com/example/${repoId}/pull/2`,
        status: 'merged',
        sourceBranch: 'bugfix/db-pool',
        targetBranch: 'main',
        author: 'gemini-dev',
        createdAt: new Date(baseDate.getTime() - 5 * 24 * 60 * 60 * 1000), // 5일 전
        updatedAt: new Date(baseDate.getTime() - 3 * 24 * 60 * 60 * 1000) // 3일 전
      },
      {
        id: 3,
        title: 'Implement real-time notifications',
        description: 'Adds WebSocket-based real-time notification system',
        url: `https://github.com/example/${repoId}/pull/3`,
        status: 'open',
        sourceBranch: 'feature/notifications',
        targetBranch: 'develop',
        author: 'claude-dev',
        createdAt: new Date(baseDate.getTime() - 1 * 24 * 60 * 60 * 1000), // 1일 전
        updatedAt: new Date(baseDate.getTime() - 2 * 60 * 60 * 1000) // 2시간 전
      }
    ];

    mockPrs.forEach(pr => {
      repoPrs.set(pr.id, pr);
    });

    this.pullRequests.set(repoId, repoPrs);
    this.nextPrId.set(repoId, 4); // 다음 ID는 4부터 시작

    // 기본 코멘트들 생성
    this.initializeComments(repoId);
  }

  private initializeComments(repoId: string): void {
    const baseDate = new Date();

    // PR 1에 대한 코멘트들
    const pr1Comments: PullRequestComment[] = [
      {
        id: 'comment-1-1',
        content: 'Great work on the authentication system! Could you add unit tests for the JWT validation?',
        author: 'reviewer-1',
        createdAt: new Date(baseDate.getTime() - 12 * 60 * 60 * 1000), // 12시간 전
        isProcessed: false
      },
      {
        id: 'comment-1-2',
        content: 'I\'ve added comprehensive tests for JWT validation and error handling.',
        author: 'claude-dev',
        createdAt: new Date(baseDate.getTime() - 6 * 60 * 60 * 1000), // 6시간 전
        isProcessed: false
      }
    ];

    // PR 2에 대한 코멘트들
    const pr2Comments: PullRequestComment[] = [
      {
        id: 'comment-2-1',
        content: 'This fix looks good. The connection pool monitoring should help prevent future issues.',
        author: 'reviewer-2',
        createdAt: new Date(baseDate.getTime() - 3 * 24 * 60 * 60 * 1000), // 3일 전
        isProcessed: true
      }
    ];

    this.comments.set(`${repoId}/1`, pr1Comments);
    this.comments.set(`${repoId}/2`, pr2Comments);
    this.comments.set(`${repoId}/3`, []); // PR 3은 코멘트 없음
  }
}
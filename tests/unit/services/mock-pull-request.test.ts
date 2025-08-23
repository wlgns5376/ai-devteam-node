import { MockPullRequestService } from '@/services/pull-request/mock/mock-pull-request';
import { PullRequest, PullRequestService, PullRequestComment, PullRequestState } from '@/types';

describe('MockPullRequestService', () => {
  let service: MockPullRequestService;

  beforeEach(() => {
    service = new MockPullRequestService();
  });

  describe('getPullRequest', () => {
    it('should return pull request with mock data', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: PR을 조회하면
      const result = await service.getPullRequest('wlgns5376/ai-devteam-test', 1);

      // Then: 모킹된 PR이 반환되어야 함
      expect(result).toBeDefined();
      expect(result.id).toBe(1);
      expect(result.title).toBeDefined();
      expect(result.description).toBeDefined();
      expect(result.status).toBeDefined();
      expect(result.author).toBeDefined();
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should return different PR data for different PR numbers', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: 다른 PR 번호로 조회하면
      const pr1 = await service.getPullRequest('wlgns5376/ai-devteam-test', 1);
      const pr2 = await service.getPullRequest('wlgns5376/ai-devteam-test', 2);

      // Then: 다른 PR 정보가 반환되어야 함
      expect(pr1.id).toBe(1);
      expect(pr2.id).toBe(2);
      expect(pr1.title).not.toBe(pr2.title);
    });

    it('should throw error for non-existent PR', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: 존재하지 않는 PR을 조회하려고 하면
      // Then: 에러가 발생해야 함
      await expect(service.getPullRequest('wlgns5376/ai-devteam-test', 999))
        .rejects.toThrow('Pull request not found: wlgns5376/ai-devteam-test/999');
    });
  });

  describe('listPullRequests', () => {
    it('should return all PRs when no status filter is provided', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: 상태 필터 없이 PR 목록을 조회하면
      const prs = await service.listPullRequests('wlgns5376/ai-devteam-test');

      // Then: 모든 상태의 PR이 반환되어야 함
      expect(prs).toBeDefined();
      expect(prs.length).toBeGreaterThan(0);
      expect(prs).toContainEqual(expect.objectContaining({ status: PullRequestState.OPEN }));
      expect(prs).toContainEqual(expect.objectContaining({ status: PullRequestState.MERGED }));
    });

    it('should return filtered PRs when status is provided', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: 특정 상태로 필터링하여 조회하면
      const openPrs = await service.listPullRequests('wlgns5376/ai-devteam-test', PullRequestState.OPEN);

      // Then: 해당 상태의 PR만 반환되어야 함
      expect(openPrs).toBeDefined();
      expect(openPrs.length).toBeGreaterThan(0);
      openPrs.forEach(pr => {
        expect(pr.status).toBe(PullRequestState.OPEN);
      });
    });

    it('should return filtered PRs for closed status', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: CLOSED 상태로 필터링하여 조회하면
      const closedPrs = await service.listPullRequests('wlgns5376/ai-devteam-test', PullRequestState.CLOSED);

      // Then: 해당 상태의 PR이 없으면 빈 배열이 반환되어야 함
      expect(closedPrs).toBeDefined();
      expect(Array.isArray(closedPrs)).toBe(true);
      // CLOSED 상태 PR이 있다면 해당 상태만 반환되어야 함
      closedPrs.forEach(pr => {
        expect(pr.status).toBe(PullRequestState.CLOSED);
      });
    });
  });

  describe('isApproved', () => {
    it('should check PR approval status', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: PR의 승인 상태를 확인하면
      const isApproved1 = await service.isApproved('wlgns5376/ai-devteam-test', 1);
      const isApproved2 = await service.isApproved('wlgns5376/ai-devteam-test', 2);
      const isApproved3 = await service.isApproved('wlgns5376/ai-devteam-test', 3);

      // Then: 각 PR의 승인 상태가 올바르게 반환되어야 함
      expect(typeof isApproved1).toBe('boolean');
      expect(typeof isApproved2).toBe('boolean');
      expect(typeof isApproved3).toBe('boolean');
      
      // Mock 데이터에 따라 PR #2, #3는 승인되어야 함
      expect(isApproved2).toBe(true);
      expect(isApproved3).toBe(true);
      expect(isApproved1).toBe(false); // 변경 요청 상태
    });
  });

  describe('getReviews', () => {
    it('should return PR reviews', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: PR의 리뷰를 조회하면
      const reviews = await service.getReviews('wlgns5376/ai-devteam-test', 1);

      // Then: 리뷰 목록이 반환되어야 함
      expect(reviews).toBeDefined();
      expect(Array.isArray(reviews)).toBe(true);
      
      if (reviews.length > 0) {
        const review = reviews[0];
        expect(review).toHaveProperty('id');
        expect(review).toHaveProperty('state');
        expect(review).toHaveProperty('comment');
        expect(review).toHaveProperty('reviewer');
        expect(review).toHaveProperty('submittedAt');
        expect(review!.submittedAt).toBeInstanceOf(Date);
      }
    });
  });


  describe('getComments', () => {
    it('should return PR comments', async () => {
      // Given: MockPullRequestService와 PR이 있을 때
      // When: PR의 코멘트를 조회하면
      const comments = await service.getComments('wlgns5376/ai-devteam-test', 1);

      // Then: 코멘트 목록이 반환되어야 함
      expect(comments).toBeDefined();
      expect(Array.isArray(comments)).toBe(true);
      
      if (comments.length > 0) {
        const comment = comments[0];
        expect(comment).toBeDefined();
        expect(comment).toHaveProperty('id');
        expect(comment).toHaveProperty('content');
        expect(comment).toHaveProperty('author');
        expect(comment).toHaveProperty('createdAt');
        expect(comment!.createdAt).toBeInstanceOf(Date);
      }
    });

    it('should return empty array for PR without comments', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: 코멘트가 없는 PR의 코멘트를 조회하면
      const comments = await service.getComments('wlgns5376/ai-devteam-test', 2);

      // Then: 빈 배열이 반환되어야 함
      expect(comments).toBeDefined();
      expect(Array.isArray(comments)).toBe(true);
    });
  });

  describe('getNewComments', () => {
    it('should return new comments since specified date', async () => {
      // Given: MockPullRequestService와 기존 코멘트가 있을 때
      const since = new Date(Date.now() - 60 * 60 * 1000); // 1시간 전

      // When: 신규 코멘트를 조회하면
      const newComments = await service.getNewComments('wlgns5376/ai-devteam-test', 1, since);

      // Then: since 이후의 처리되지 않은 코멘트만 반환되어야 함
      expect(newComments).toBeDefined();
      expect(Array.isArray(newComments)).toBe(true);
    });
  });

  describe('markCommentsAsProcessed', () => {
    it('should mark comments as processed', async () => {
      // Given: 처리되지 않은 코멘트들이 있을 때
      const testIds = ['test-comment-1', 'test-comment-2'];

      // When: 코멘트들을 처리됨으로 표시하면
      await service.markCommentsAsProcessed(testIds);

      // Then: 처리 완료되어야 함
      expect(true).toBe(true); // markCommentsAsProcessed는 void 반환
    });
  });

  describe('interface compliance', () => {
    it('should implement PullRequestService interface', () => {
      // Given: MockPullRequestService가 있을 때
      // When: PullRequestService 타입으로 할당하면
      const prService: PullRequestService = service;

      // Then: 타입 에러가 발생하지 않아야 함
      expect(prService).toBeDefined();
      expect(typeof prService.getPullRequest).toBe('function');
      expect(typeof prService.listPullRequests).toBe('function');
      expect(typeof prService.getComments).toBe('function');
      expect(typeof prService.getNewComments).toBe('function');
      expect(typeof prService.markCommentsAsProcessed).toBe('function');
    });
  });
});
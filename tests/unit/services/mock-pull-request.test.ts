import { MockPullRequestService } from '@/services/mock-pull-request';
import { PullRequest, PullRequestService, PullRequestComment } from '@/types';

describe('MockPullRequestService', () => {
  let service: MockPullRequestService;

  beforeEach(() => {
    service = new MockPullRequestService();
  });

  describe('getPullRequest', () => {
    it('should return pull request with mock data', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: PR을 조회하면
      const result = await service.getPullRequest('repo-1', 1);

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
      const pr1 = await service.getPullRequest('repo-1', 1);
      const pr2 = await service.getPullRequest('repo-1', 2);

      // Then: 다른 PR 정보가 반환되어야 함
      expect(pr1.id).toBe(1);
      expect(pr2.id).toBe(2);
      expect(pr1.title).not.toBe(pr2.title);
    });

    it('should throw error for non-existent PR', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: 존재하지 않는 PR을 조회하려고 하면
      // Then: 에러가 발생해야 함
      await expect(service.getPullRequest('repo-1', 999))
        .rejects.toThrow('Pull request not found: repo-1/999');
    });
  });

  describe('listPullRequests', () => {
    it('should return all PRs when no status filter is provided', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: 상태 필터 없이 PR 목록을 조회하면
      const prs = await service.listPullRequests('repo-1');

      // Then: 모든 상태의 PR이 반환되어야 함
      expect(prs).toBeDefined();
      expect(prs.length).toBeGreaterThan(0);
      expect(prs).toContainEqual(expect.objectContaining({ status: 'open' }));
      expect(prs).toContainEqual(expect.objectContaining({ status: 'merged' }));
    });

    it('should return filtered PRs when status is provided', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: 특정 상태로 필터링하여 조회하면
      const openPrs = await service.listPullRequests('repo-1', 'open');

      // Then: 해당 상태의 PR만 반환되어야 함
      expect(openPrs).toBeDefined();
      expect(openPrs.length).toBeGreaterThan(0);
      openPrs.forEach(pr => {
        expect(pr.status).toBe('open');
      });
    });

    it('should return empty array for unknown status', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: 존재하지 않는 상태로 조회하면
      const prs = await service.listPullRequests('repo-1', 'unknown_status');

      // Then: 빈 배열이 반환되어야 함
      expect(prs).toBeDefined();
      expect(prs).toHaveLength(0);
    });
  });

  describe('createPullRequest', () => {
    it('should create new pull request successfully', async () => {
      // Given: MockPullRequestService가 있을 때
      const newPrData = {
        title: 'New feature implementation',
        description: 'This PR adds a new feature',
        sourceBranch: 'feature/new-feature',
        targetBranch: 'main',
        author: 'test-user'
      };

      // When: 새로운 PR을 생성하면
      const createdPr = await service.createPullRequest('repo-1', newPrData);

      // Then: 새로운 PR이 생성되어야 함
      expect(createdPr).toBeDefined();
      expect(createdPr.title).toBe(newPrData.title);
      expect(createdPr.description).toBe(newPrData.description);
      expect(createdPr.sourceBranch).toBe(newPrData.sourceBranch);
      expect(createdPr.targetBranch).toBe(newPrData.targetBranch);
      expect(createdPr.author).toBe(newPrData.author);
      expect(createdPr.status).toBe('open');
      expect(createdPr.createdAt).toBeInstanceOf(Date);
      expect(createdPr.updatedAt).toBeInstanceOf(Date);
    });

    it('should assign unique ID to created PR', async () => {
      // Given: MockPullRequestService가 있을 때
      const prData = {
        title: 'Test PR 1',
        description: 'Description 1',
        sourceBranch: 'feature/test-1',
        targetBranch: 'main',
        author: 'test-user'
      };

      // When: PR을 여러 번 생성하면
      const pr1 = await service.createPullRequest('repo-1', prData);
      const pr2 = await service.createPullRequest('repo-1', { ...prData, title: 'Test PR 2' });

      // Then: 각각 다른 ID가 할당되어야 함
      expect(pr1.id).not.toBe(pr2.id);
      expect(pr1.id).toBeGreaterThan(0);
      expect(pr2.id).toBeGreaterThan(0);
    });
  });

  describe('updatePullRequestStatus', () => {
    it('should update PR status successfully', async () => {
      // Given: MockPullRequestService와 기존 PR이 있을 때
      const pr = await service.getPullRequest('repo-1', 1);
      expect(pr.status).not.toBe('merged');

      // When: PR 상태를 업데이트하면
      const updatedPr = await service.updatePullRequestStatus('repo-1', 1, 'merged');

      // Then: 상태가 업데이트되어야 함
      expect(updatedPr).toBeDefined();
      expect(updatedPr.id).toBe(1);
      expect(updatedPr.status).toBe('merged');
      expect(updatedPr.updatedAt).toBeInstanceOf(Date);
      expect(updatedPr.updatedAt.getTime()).toBeGreaterThan(pr.updatedAt.getTime());
    });

    it('should throw error for non-existent PR', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: 존재하지 않는 PR의 상태를 업데이트하려고 하면
      // Then: 에러가 발생해야 함
      await expect(service.updatePullRequestStatus('repo-1', 999, 'closed'))
        .rejects.toThrow('Pull request not found: repo-1/999');
    });

    it('should persist status changes across getPullRequest calls', async () => {
      // Given: MockPullRequestService와 PR이 있을 때
      // When: PR 상태를 업데이트하고
      await service.updatePullRequestStatus('repo-1', 1, 'closed');

      // Then: 이후 조회에서도 업데이트된 상태가 유지되어야 함
      const updatedPr = await service.getPullRequest('repo-1', 1);
      expect(updatedPr.status).toBe('closed');
    });
  });

  describe('addComment', () => {
    it('should add comment to PR successfully', async () => {
      // Given: MockPullRequestService와 기존 PR이 있을 때
      const initialComments = await service.getComments('repo-1', 1);
      const initialCommentCount = initialComments.length;
      const newComment = 'This is a test comment';

      // When: PR에 코멘트를 추가하면
      const addedComment = await service.addComment('repo-1', 1, newComment, 'test-user');

      // Then: 코멘트가 추가되어야 함
      expect(addedComment).toBeDefined();
      expect(addedComment.content).toBe(newComment);
      expect(addedComment.author).toBe('test-user');
      expect(addedComment.createdAt).toBeInstanceOf(Date);

      // And: 전체 코멘트 수가 증가해야 함
      const updatedComments = await service.getComments('repo-1', 1);
      expect(updatedComments).toHaveLength(initialCommentCount + 1);
      expect(updatedComments).toContainEqual(addedComment);
    });

    it('should throw error for non-existent PR', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: 존재하지 않는 PR에 코멘트를 추가하려고 하면
      // Then: 에러가 발생해야 함
      await expect(service.addComment('repo-1', 999, 'Test comment', 'test-user'))
        .rejects.toThrow('Pull request not found: repo-1/999');
    });
  });

  describe('getComments', () => {
    it('should return PR comments', async () => {
      // Given: MockPullRequestService와 PR이 있을 때
      // When: PR의 코멘트를 조회하면
      const comments = await service.getComments('repo-1', 1);

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

    it('should throw error for non-existent PR', async () => {
      // Given: MockPullRequestService가 있을 때
      // When: 존재하지 않는 PR의 코멘트를 조회하려고 하면
      // Then: 에러가 발생해야 함
      await expect(service.getComments('repo-1', 999))
        .rejects.toThrow('Pull request not found: repo-1/999');
    });
  });

  describe('getNewComments', () => {
    it('should return new comments since specified date', async () => {
      // Given: MockPullRequestService와 기존 코멘트가 있을 때
      const since = new Date(Date.now() - 60 * 60 * 1000); // 1시간 전
      
      // 새로운 코멘트 추가
      await service.addComment('repo-1', 1, 'New feedback comment', 'reviewer');

      // When: 신규 코멘트를 조회하면
      const newComments = await service.getNewComments('repo-1', 1, since);

      // Then: since 이후의 처리되지 않은 코멘트만 반환되어야 함
      expect(newComments.length).toBeGreaterThan(0);
      newComments.forEach(comment => {
        expect(comment.createdAt.getTime()).toBeGreaterThan(since.getTime());
        expect(comment.isProcessed).toBe(false);
      });
    });

    it('should not return processed comments', async () => {
      // Given: 처리된 코멘트가 있을 때
      const comment = await service.addComment('repo-1', 1, 'Processed comment', 'reviewer');
      await service.markCommentsAsProcessed([comment.id]);

      const since = new Date(Date.now() - 60 * 60 * 1000);

      // When: 신규 코멘트를 조회하면
      const newComments = await service.getNewComments('repo-1', 1, since);

      // Then: 처리된 코멘트는 반환되지 않아야 함
      expect(newComments.find(c => c.id === comment.id)).toBeUndefined();
    });
  });

  describe('markCommentsAsProcessed', () => {
    it('should mark comments as processed', async () => {
      // Given: 처리되지 않은 코멘트들이 있을 때
      const comment1 = await service.addComment('repo-1', 1, 'Comment 1', 'reviewer');
      const comment2 = await service.addComment('repo-1', 1, 'Comment 2', 'reviewer');

      // When: 코멘트들을 처리됨으로 표시하면
      await service.markCommentsAsProcessed([comment1.id, comment2.id]);

      // Then: 해당 코멘트들이 처리됨으로 표시되어야 함
      const since = new Date(Date.now() - 60 * 60 * 1000);
      const newComments = await service.getNewComments('repo-1', 1, since);
      
      expect(newComments.find(c => c.id === comment1.id)).toBeUndefined();
      expect(newComments.find(c => c.id === comment2.id)).toBeUndefined();
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
      expect(typeof prService.createPullRequest).toBe('function');
      expect(typeof prService.updatePullRequestStatus).toBe('function');
      expect(typeof prService.addComment).toBe('function');
      expect(typeof prService.getComments).toBe('function');
      expect(typeof prService.getNewComments).toBe('function');
      expect(typeof prService.markCommentsAsProcessed).toBe('function');
    });
  });
});
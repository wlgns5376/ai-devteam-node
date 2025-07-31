import { GitHubPullRequestService } from '../../../../src/services/pull-request/github/github-pull-request.service';
import { CommentFilterOptions, DEFAULT_ALLOWED_BOTS } from '../../../../src/types';
import { Logger } from '../../../../src/services/logger';

// Mock Octokit
jest.mock('@octokit/rest');

describe('GitHubPullRequestService - Comment Filtering', () => {
  let service: GitHubPullRequestService;
  let mockOctokit: any;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    } as any;

    mockOctokit = {
      rest: {
        pulls: {
          get: jest.fn(),
          listReviews: jest.fn(),
          listReviewComments: jest.fn()
        },
        issues: {
          listComments: jest.fn()
        }
      }
    };

    // Mock Octokit constructor
    const { Octokit } = require('@octokit/rest');
    (Octokit as jest.Mock).mockImplementation(() => mockOctokit);

    service = new GitHubPullRequestService({ token: 'test-token' }, mockLogger);
  });

  describe('getNewComments with filtering', () => {
    const repoId = 'owner/repo';
    const prNumber = 1;
    const since = new Date('2023-01-01');

    const mockPullRequest = {
      number: 1,
      title: 'Test PR',
      body: 'Test description',
      html_url: 'https://github.com/owner/repo/pull/1',
      state: 'open',
      draft: false,
      merged_at: null,
      head: { ref: 'feature-branch' },
      base: { ref: 'main' },
      user: { login: 'pr-author' },
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    };

    const mockComments = [
      {
        id: 1,
        body: 'Comment from PR author',
        user: { login: 'pr-author' },
        created_at: '2023-01-02T00:00:00Z',
        updated_at: null,
        html_url: 'https://github.com/owner/repo/pull/1#issuecomment-1'
      },
      {
        id: 2,
        body: 'Comment from reviewer',
        user: { login: 'reviewer' },
        created_at: '2023-01-02T00:00:00Z',
        updated_at: null,
        html_url: 'https://github.com/owner/repo/pull/1#issuecomment-2'
      },
      {
        id: 3,
        body: 'CI build passed',
        user: { login: 'github-actions[bot]' },
        created_at: '2023-01-02T00:00:00Z',
        updated_at: null,
        html_url: 'https://github.com/owner/repo/pull/1#issuecomment-3'
      },
      {
        id: 4,
        body: 'Code quality issues found',
        user: { login: 'sonarcloud[bot]' },
        created_at: '2023-01-02T00:00:00Z',
        updated_at: null,
        html_url: 'https://github.com/owner/repo/pull/1#issuecomment-4'
      }
    ];

    beforeEach(() => {
      mockOctokit.rest.pulls.get.mockResolvedValue({ data: mockPullRequest });
      mockOctokit.rest.issues.listComments.mockResolvedValue({ data: mockComments });
      mockOctokit.rest.pulls.listReviewComments.mockResolvedValue({ data: [] });
      mockOctokit.rest.pulls.listReviews.mockResolvedValue({ data: [] });
    });

    it('should exclude PR author comments by default', async () => {
      const result = await service.getNewComments(repoId, prNumber, since);

      expect(result).toHaveLength(2); // reviewer + sonarcloud[bot] (PR 작성자와 github-actions[bot] 제외)
      expect(result.some(c => c.author === 'pr-author')).toBe(false);
      expect(result.some(c => c.author === 'reviewer')).toBe(true);
      expect(result.some(c => c.author === 'github-actions[bot]')).toBe(false); // 기본적으로 제외됨
      expect(result.some(c => c.author === 'sonarcloud[bot]')).toBe(true); // 허용됨
    });

    it('should exclude PR author when excludeAuthor is true', async () => {
      const options: CommentFilterOptions = { excludeAuthor: true };
      const result = await service.getNewComments(repoId, prNumber, since, options);

      expect(result).toHaveLength(2); // reviewer + sonarcloud[bot]
      expect(result.some(c => c.author === 'pr-author')).toBe(false);
    });

    it('should include PR author when excludeAuthor is false', async () => {
      const options: CommentFilterOptions = { excludeAuthor: false };
      const result = await service.getNewComments(repoId, prNumber, since, options);

      expect(result).toHaveLength(3); // pr-author + reviewer + sonarcloud[bot] (github-actions[bot]은 여전히 제외)
      expect(result.some(c => c.author === 'pr-author')).toBe(true);
    });

    it('should only allow bots in whitelist', async () => {
      const options: CommentFilterOptions = { 
        excludeAuthor: false,
        allowedBots: ['sonarcloud[bot]'] // github-actions[bot]는 포함되지 않음
      };
      const result = await service.getNewComments(repoId, prNumber, since, options);

      expect(result).toHaveLength(3); // PR author + reviewer + sonarcloud[bot]
      expect(result.some(c => c.author === 'github-actions[bot]')).toBe(false);
      expect(result.some(c => c.author === 'sonarcloud[bot]')).toBe(true);
    });

    it('should only allow whitelisted bots', async () => {
      const options: CommentFilterOptions = {
        excludeAuthor: false,
        allowedBots: ['sonarcloud[bot]'] // github-actions[bot]는 포함되지 않음
      };
      const result = await service.getNewComments(repoId, prNumber, since, options);

      expect(result).toHaveLength(3); // PR author + reviewer + sonarcloud[bot]
      expect(result.some(c => c.author === 'github-actions[bot]')).toBe(false);
      expect(result.some(c => c.author === 'sonarcloud[bot]')).toBe(true);
    });

    it('should exclude all bots when allowedBots is empty', async () => {
      const options: CommentFilterOptions = {
        excludeAuthor: false,
        allowedBots: [] // 허용된 봇이 없음
      };
      const result = await service.getNewComments(repoId, prNumber, since, options);

      expect(result).toHaveLength(2); // PR author + reviewer만
      expect(result.some(c => c.author === 'github-actions[bot]')).toBe(false);
      expect(result.some(c => c.author === 'sonarcloud[bot]')).toBe(false);
      expect(result.some(c => c.author === 'pr-author')).toBe(true);
      expect(result.some(c => c.author === 'reviewer')).toBe(true);
    });

    it('should use default bot filters when no options provided', async () => {
      const result = await service.getNewComments(repoId, prNumber, since);

      // Default: excludeAuthor=true, use default excluded/allowed bots
      expect(result.some(c => c.author === 'pr-author')).toBe(false);
      expect(result.some(c => c.author === 'github-actions[bot]')).toBe(false); // excluded by default
      expect(result.some(c => c.author === 'sonarcloud[bot]')).toBe(true); // allowed by default
      expect(result.some(c => c.author === 'reviewer')).toBe(true);
    });

    it('should filter comments created before since date', async () => {
      const laterSince = new Date('2023-01-03');
      const result = await service.getNewComments(repoId, prNumber, laterSince);

      expect(result).toHaveLength(0); // 모든 코멘트가 since 이전
    });
  });
});
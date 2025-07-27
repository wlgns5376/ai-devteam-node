import { GitHubProjectBoardService } from '@/services/project-board/github/github-project-board.service';
import { GitHubProjectConfig, GitHubApiError } from '@/services/project-board/github/types';
import { ProjectBoard, ProjectBoardItem } from '@/types';
import { Logger } from '@/services/logger';

// Mock GitHubApiClient to avoid Octokit ESM issues
const mockApiClient = {
  listProjects: jest.fn(),
  getProject: jest.fn(),
  listColumns: jest.fn(),
  listCards: jest.fn(),
  getCard: jest.fn(),
  updateCard: jest.fn(),
  moveCard: jest.fn()
};

// Mock the GitHubApiClient module
jest.mock('@/services/project-board/github/github-api-client', () => {
  return {
    GitHubApiClient: jest.fn().mockImplementation(() => mockApiClient)
  };
});

jest.mock('@/services/logger');

describe('GitHubProjectBoardService', () => {
  let service: GitHubProjectBoardService;
  let mockLogger: jest.Mocked<Logger>;
  let config: GitHubProjectConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    } as any;

    config = {
      owner: 'test-owner',
      repo: 'test-repo',
      projectNumber: 1,
      token: 'test-token'
    };

    service = new GitHubProjectBoardService(config, mockLogger);
  });

  describe('initialize', () => {
    it('should load project metadata and column mappings', async () => {
      const mockProject = {
        data: {
          id: 123,
          name: 'Test Project',
          number: 1,
          state: 'open',
          html_url: 'https://github.com/test-owner/test-repo/projects/1'
        }
      };

      const mockColumns = {
        data: [
          { id: 1, name: 'To do' },
          { id: 2, name: 'In progress' },
          { id: 3, name: 'In review' },
          { id: 4, name: 'Done' }
        ]
      };

      mockApiClient.listProjects.mockResolvedValueOnce({ data: [mockProject.data] });
      mockApiClient.listColumns.mockResolvedValueOnce(mockColumns);

      await service.initialize();

      expect(mockApiClient.listProjects).toHaveBeenCalledWith(
        'test-owner',
        'test-repo',
        'open'
      );

      expect(mockApiClient.listColumns).toHaveBeenCalledWith(123);
    });

    it('should throw error if project not found', async () => {
      mockApiClient.listProjects.mockResolvedValueOnce({ data: [] });

      await expect(service.initialize()).rejects.toThrow('Project not found');
    });
  });

  describe('getBoard', () => {
    beforeEach(async () => {
      const mockProject = {
        data: {
          id: 123,
          name: 'Test Project',
          number: 1,
          state: 'open',
          html_url: 'https://github.com/test-owner/test-repo/projects/1',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        }
      };

      mockApiClient.listProjects.mockResolvedValueOnce({ data: [mockProject.data] });
      mockApiClient.listColumns.mockResolvedValueOnce({ data: [] });
      
      await service.initialize();
    });

    it('should return project board information', async () => {
      const mockProject = {
        data: {
          id: 123,
          name: 'Test Project',
          body: 'Test Description',
          number: 1,
          state: 'open',
          html_url: 'https://github.com/test-owner/test-repo/projects/1',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z'
        }
      };

      mockApiClient.getProject.mockResolvedValueOnce(mockProject);

      const board = await service.getBoard('123');

      expect(board).toEqual({
        id: '123',
        name: 'Test Project',
        description: 'Test Description',
        url: 'https://github.com/test-owner/test-repo/projects/1',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-02T00:00:00Z')
      });
    });
  });

  describe('getItems', () => {
    beforeEach(async () => {
      const mockProject = {
        data: {
          id: 123,
          name: 'Test Project',
          number: 1,
          state: 'open',
          html_url: 'https://github.com/test-owner/test-repo/projects/1'
        }
      };

      const mockColumns = {
        data: [
          { id: 1, name: 'To do' },
          { id: 2, name: 'In progress' },
          { id: 3, name: 'In review' },
          { id: 4, name: 'Done' }
        ]
      };

      mockApiClient.listProjects.mockResolvedValueOnce({ data: [mockProject.data] });
      mockApiClient.listColumns.mockResolvedValueOnce(mockColumns);
      
      await service.initialize();
    });

    it('should get items by status', async () => {
      const mockCards = {
        data: [
          {
            id: 101,
            note: 'Task 1: Implement feature',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-02T00:00:00Z',
            archived: false,
            column_url: 'https://api.github.com/projects/columns/1',
            content_url: null
          },
          {
            id: 102,
            note: 'Task 2: Write tests\nPR: https://github.com/test-owner/test-repo/pull/123',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-02T00:00:00Z',
            archived: false,
            column_url: 'https://api.github.com/projects/columns/1',
            content_url: null
          }
        ]
      };

      mockApiClient.listCards.mockResolvedValueOnce(mockCards);

      const items = await service.getItems('123', 'TODO');

      expect(mockApiClient.listCards).toHaveBeenCalledWith(1, 'not_archived');

      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        id: '101',
        title: 'Task 1: Implement feature',
        status: 'TODO',
        pullRequestUrls: []
      });
      expect(items[1]).toMatchObject({
        id: '102',
        title: 'Task 2: Write tests',
        status: 'TODO',
        pullRequestUrls: ['https://github.com/test-owner/test-repo/pull/123']
      });
    });

    it('should get all items when no status specified', async () => {
      const mockCards1 = {
        data: [
          {
            id: 101,
            note: 'Task 1',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-02T00:00:00Z',
            archived: false,
            column_url: 'https://api.github.com/projects/columns/1',
            content_url: null
          }
        ]
      };

      const mockCards2 = {
        data: [
          {
            id: 102,
            note: 'Task 2',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-02T00:00:00Z',
            archived: false,
            column_url: 'https://api.github.com/projects/columns/2',
            content_url: null
          }
        ]
      };

      mockApiClient.listCards
        .mockResolvedValueOnce(mockCards1)
        .mockResolvedValueOnce(mockCards2)
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      const items = await service.getItems('123');

      expect(mockApiClient.listCards).toHaveBeenCalledTimes(4);
      expect(items).toHaveLength(2);
    });
  });

  describe('updateItemStatus', () => {
    beforeEach(async () => {
      const mockProject = {
        data: {
          id: 123,
          name: 'Test Project',
          number: 1,
          state: 'open'
        }
      };

      const mockColumns = {
        data: [
          { id: 1, name: 'To do' },
          { id: 2, name: 'In progress' },
          { id: 3, name: 'In review' },
          { id: 4, name: 'Done' }
        ]
      };

      mockApiClient.listProjects.mockResolvedValueOnce({ data: [mockProject.data] });
      mockApiClient.listColumns.mockResolvedValueOnce(mockColumns);
      
      await service.initialize();
    });

    it('should move card to new column', async () => {
      const mockCard = {
        data: {
          id: 101,
          note: 'Task 1',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
          archived: false,
          column_url: 'https://api.github.com/projects/columns/2',
          content_url: null
        }
      };

      mockApiClient.moveCard.mockResolvedValueOnce({});
      mockApiClient.getCard.mockResolvedValueOnce(mockCard);

      const updatedItem = await service.updateItemStatus('101', 'IN_PROGRESS');

      expect(mockApiClient.moveCard).toHaveBeenCalledWith(101, 2, 'top');

      expect(updatedItem.status).toBe('IN_PROGRESS');
    });

    it('should throw error for invalid status', async () => {
      await expect(service.updateItemStatus('101', 'INVALID_STATUS')).rejects.toThrow('Invalid status: INVALID_STATUS');
    });
  });

  describe('addPullRequestToItem', () => {
    beforeEach(async () => {
      const mockProject = {
        data: {
          id: 123,
          name: 'Test Project',
          number: 1,
          state: 'open'
        }
      };

      mockApiClient.listProjects.mockResolvedValueOnce({ data: [mockProject.data] });
      mockApiClient.listColumns.mockResolvedValueOnce({ data: [] });
      
      await service.initialize();
    });

    it('should add PR link to card note', async () => {
      const mockCard = {
        data: {
          id: 101,
          note: 'Task 1: Implement feature',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z'
        }
      };

      mockApiClient.getCard.mockResolvedValueOnce(mockCard);
      mockApiClient.updateCard.mockResolvedValueOnce({});

      await service.addPullRequestToItem('101', 'https://github.com/test-owner/test-repo/pull/123');

      expect(mockApiClient.updateCard).toHaveBeenCalledWith(
        101,
        'Task 1: Implement feature\nPR: https://github.com/test-owner/test-repo/pull/123'
      );
    });

    it('should not add duplicate PR links', async () => {
      const mockCard = {
        data: {
          id: 101,
          note: 'Task 1\nPR: https://github.com/test-owner/test-repo/pull/123',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z'
        }
      };

      mockApiClient.getCard.mockResolvedValueOnce(mockCard);

      await service.addPullRequestToItem('101', 'https://github.com/test-owner/test-repo/pull/123');

      expect(mockApiClient.updateCard).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle API rate limiting', async () => {
      const rateLimitError = {
        status: 429,
        message: 'API rate limit exceeded',
        response: {
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60)
          }
        }
      };

      mockApiClient.getProject.mockRejectedValueOnce(rateLimitError);

      await expect(service.getBoard('123')).rejects.toThrow(GitHubApiError);
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network error');
      
      // Initialize()를 위한 프로젝트와 컬럼 mock 설정
      const mockProject = {
        data: {
          id: 123,
          name: 'Test Project',
          number: 1,
          state: 'open',
          html_url: 'https://github.com/test-owner/test-repo/projects/1'
        }
      };
      
      mockApiClient.listProjects.mockResolvedValueOnce({ data: [mockProject.data] });
      mockApiClient.listColumns.mockResolvedValueOnce({ data: [] });
      
      // Initialize 후 getProject에서 네트워크 에러 발생
      mockApiClient.getProject.mockRejectedValueOnce(networkError);

      await expect(service.getBoard('123')).rejects.toThrow(GitHubApiError);
      
      try {
        await service.getBoard('123');
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubApiError);
        expect((error as GitHubApiError).message).toContain('Network error');
      }
    });
  });
});
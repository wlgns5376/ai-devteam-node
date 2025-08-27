import { BaseBranchExtractor } from '@/services/git/base-branch-extractor';
import { Logger } from '@/services/logger';
import { WorkerTask, WorkerAction } from '@/types/worker.types';

describe('BaseBranchExtractor', () => {
  let baseBranchExtractor: BaseBranchExtractor;
  let mockLogger: jest.Mocked<Logger>;
  let mockGetRepositoryDefaultBranch: jest.Mock;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    mockGetRepositoryDefaultBranch = jest.fn();

    baseBranchExtractor = new BaseBranchExtractor({
      logger: mockLogger,
      getRepositoryDefaultBranch: mockGetRepositoryDefaultBranch
    });
  });

  describe('extractFromLabels', () => {
    it('should extract base branch from valid label format', () => {
      const labels = ['priority:high', 'base:develop', 'bug'];
      const result = baseBranchExtractor.extractFromLabels(labels);
      expect(result).toBe('develop');
    });

    it('should extract base branch with slash in branch name', () => {
      const labels = ['base:feature/auth-system', 'enhancement'];
      const result = baseBranchExtractor.extractFromLabels(labels);
      expect(result).toBe('feature/auth-system');
    });

    it('should extract base branch with complex branch name', () => {
      const labels = ['base:release/v2.0', 'priority:medium'];
      const result = baseBranchExtractor.extractFromLabels(labels);
      expect(result).toBe('release/v2.0');
    });

    it('should return null when no base label is present', () => {
      const labels = ['priority:high', 'bug', 'enhancement'];
      const result = baseBranchExtractor.extractFromLabels(labels);
      expect(result).toBeNull();
    });

    it('should return null for empty labels array', () => {
      const labels: string[] = [];
      const result = baseBranchExtractor.extractFromLabels(labels);
      expect(result).toBeNull();
    });

    it('should handle case-insensitive base prefix', () => {
      const labels = ['Base:main', 'BASE:develop', 'base:feature/test'];
      const result = baseBranchExtractor.extractFromLabels(labels);
      expect(result).toBe('main'); // First valid match
    });

    it('should return first base label when multiple exist', () => {
      const labels = ['base:develop', 'base:main', 'base:feature/test'];
      const result = baseBranchExtractor.extractFromLabels(labels);
      expect(result).toBe('develop');
    });

    it('should ignore invalid base label formats', () => {
      const labels = ['base:', 'base', 'base-develop', 'basetest', ':develop'];
      const result = baseBranchExtractor.extractFromLabels(labels);
      expect(result).toBeNull();
    });

    it('should trim whitespace from branch name', () => {
      const labels = ['base: develop ', 'base:  main'];
      const result = baseBranchExtractor.extractFromLabels(labels);
      expect(result).toBe('develop');
    });
  });

  describe('getRepositoryDefault', () => {
    it('should return repository default branch', async () => {
      mockGetRepositoryDefaultBranch.mockResolvedValue('develop');
      
      const result = await baseBranchExtractor.getRepositoryDefault('owner/repo');
      
      expect(result).toBe('develop');
      expect(mockGetRepositoryDefaultBranch).toHaveBeenCalledWith('owner/repo');
    });

    it('should return null when API call fails', async () => {
      mockGetRepositoryDefaultBranch.mockRejectedValue(new Error('API Error'));
      
      const result = await baseBranchExtractor.getRepositoryDefault('owner/repo');
      
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get repository default branch',
        expect.objectContaining({ repositoryId: 'owner/repo' })
      );
    });
  });

  describe('extractBaseBranch', () => {
    const createMockTask = (labels?: string[]): WorkerTask => ({
      taskId: 'task-123',
      action: WorkerAction.START_NEW_TASK,
      boardItem: labels ? { labels } : undefined,
      assignedAt: new Date(),
      repositoryId: 'owner/repo'
    });

    it('should extract branch from labels first', async () => {
      const task = createMockTask(['base:feature/auth', 'priority:high']);
      mockGetRepositoryDefaultBranch.mockResolvedValue('develop');
      
      const result = await baseBranchExtractor.extractBaseBranch(task);
      
      expect(result).toBe('feature/auth');
      expect(mockGetRepositoryDefaultBranch).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Extracted base branch from labels',
        expect.objectContaining({ 
          taskId: 'task-123',
          baseBranch: 'feature/auth' 
        })
      );
    });

    it('should fallback to repository default when no label', async () => {
      const task = createMockTask(['priority:high', 'bug']);
      mockGetRepositoryDefaultBranch.mockResolvedValue('develop');
      
      const result = await baseBranchExtractor.extractBaseBranch(task);
      
      expect(result).toBe('develop');
      expect(mockGetRepositoryDefaultBranch).toHaveBeenCalledWith('owner/repo');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Using repository default branch as base branch',
        expect.objectContaining({ 
          taskId: 'task-123',
          baseBranch: 'develop' 
        })
      );
    });

    it('should fallback to main when all else fails', async () => {
      const task = createMockTask(['priority:high']);
      mockGetRepositoryDefaultBranch.mockRejectedValue(new Error('API Error'));
      
      const result = await baseBranchExtractor.extractBaseBranch(task);
      
      expect(result).toBe('main');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Using "main" as final fallback branch',
        expect.objectContaining({ 
          taskId: 'task-123',
          baseBranch: 'main' 
        })
      );
    });

    it('should handle task without boardItem', async () => {
      const task: WorkerTask = {
        taskId: 'task-123',
        action: WorkerAction.START_NEW_TASK,
        assignedAt: new Date(),
        repositoryId: 'owner/repo'
      };
      mockGetRepositoryDefaultBranch.mockResolvedValue('master');
      
      const result = await baseBranchExtractor.extractBaseBranch(task);
      
      expect(result).toBe('master');
    });

    it('should handle task with boardItem but no labels', async () => {
      const task: WorkerTask = {
        taskId: 'task-123',
        action: WorkerAction.START_NEW_TASK,
        boardItem: {},
        assignedAt: new Date(),
        repositoryId: 'owner/repo'
      };
      mockGetRepositoryDefaultBranch.mockResolvedValue('main');
      
      const result = await baseBranchExtractor.extractBaseBranch(task);
      
      expect(result).toBe('main');
    });

    it('should handle task with empty labels array', async () => {
      const task = createMockTask([]);
      mockGetRepositoryDefaultBranch.mockResolvedValue('develop');
      
      const result = await baseBranchExtractor.extractBaseBranch(task);
      
      expect(result).toBe('develop');
    });
  });
});
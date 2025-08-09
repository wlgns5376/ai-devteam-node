import { ProjectBoard, ProjectBoardItem, ProjectBoardService } from '@/types';

export class MockProjectBoardService implements ProjectBoardService {
  private boards: Map<string, ProjectBoard> = new Map();
  private items: Map<string, ProjectBoardItem[]> = new Map();

  constructor() {
    this.initializeMockData();
  }

  async getBoard(boardId: string): Promise<ProjectBoard> {
    let board = this.boards.get(boardId);
    
    if (!board) {
      // 동적으로 보드 생성
      board = {
        id: boardId,
        name: boardId === 'board-1' ? 'AI DevTeam Project' : `Mock Board ${boardId}`,
        description: boardId === 'board-1' 
          ? 'Mock project board for AI DevTeam automation system'
          : `Mock project board for ${boardId}`,
        url: `https://mock-board.example.com/${boardId}`,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.boards.set(boardId, board);
    }

    return board;
  }

  async getItems(boardId: string, status?: string): Promise<ReadonlyArray<ProjectBoardItem>> {
    // 보드가 없으면 생성
    await this.getBoard(boardId);

    let boardItems = this.items.get(boardId);
    if (!boardItems) {
      boardItems = this.createMockItems(boardId);
      this.items.set(boardId, boardItems);
    }

    if (status) {
      return boardItems.filter(item => item.status === status);
    }

    return [...boardItems];
  }

  async updateItemStatus(itemId: string, status: string): Promise<ProjectBoardItem> {
    // 모든 보드에서 아이템 찾기
    for (const [boardId, boardItems] of this.items.entries()) {
      const itemIndex = boardItems.findIndex(item => item.id === itemId);
      if (itemIndex !== -1) {
        const item = boardItems[itemIndex];
        if (!item) {
          throw new Error(`Item not found: ${itemId}`);
        }
        
        const updatedItem: ProjectBoardItem = {
          id: item.id,
          title: item.title,
          description: item.description,
          status,
          priority: item.priority,
          assignee: item.assignee,
          labels: item.labels,
          createdAt: item.createdAt,
          updatedAt: new Date(),
          pullRequestUrls: item.pullRequestUrls,
          metadata: item.metadata
        };
        boardItems[itemIndex] = updatedItem;
        return updatedItem;
      }
    }

    throw new Error(`Item not found: ${itemId}`);
  }

  async addPullRequestToItem(itemId: string, pullRequestUrl: string): Promise<ProjectBoardItem> {
    // 모든 보드에서 아이템 찾기
    for (const [boardId, boardItems] of this.items.entries()) {
      const itemIndex = boardItems.findIndex(item => item.id === itemId);
      if (itemIndex !== -1) {
        const item = boardItems[itemIndex];
        if (!item) {
          throw new Error(`Item not found: ${itemId}`);
        }
        
        const updatedPullRequestUrls = [...(item.pullRequestUrls || [])];
        if (!updatedPullRequestUrls.includes(pullRequestUrl)) {
          updatedPullRequestUrls.push(pullRequestUrl);
        }

        const updatedItem: ProjectBoardItem = {
          id: item.id,
          title: item.title,
          description: item.description,
          status: item.status,
          priority: item.priority,
          assignee: item.assignee,
          labels: item.labels,
          createdAt: item.createdAt,
          updatedAt: new Date(),
          pullRequestUrls: updatedPullRequestUrls,
          metadata: item.metadata
        };
        boardItems[itemIndex] = updatedItem;
        return updatedItem;
      }
    }

    throw new Error(`Item not found: ${itemId}`);
  }

  private initializeMockData(): void {
    // 기본 보드 생성
    const defaultBoard: ProjectBoard = {
      id: 'board-1',
      name: 'AI DevTeam Project',
      description: 'Mock project board for AI DevTeam automation system',
      url: 'https://mock-board.example.com/board-1',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.boards.set('board-1', defaultBoard);

    // 기본 아이템들 생성
    const defaultItems = this.createMockItems('board-1');
    this.items.set('board-1', defaultItems);
  }

  private createMockItems(boardId: string): ProjectBoardItem[] {
    const baseDate = new Date();
    
    return [
      {
        id: `${boardId}-item-1`,
        title: 'Setup project structure',
        description: 'Initialize TypeScript project with necessary dependencies',
        status: 'DONE',
        priority: 'HIGH',
        assignee: 'claude-dev',
        labels: ['setup', 'typescript', 'infrastructure'],
        createdAt: new Date(baseDate.getTime() - 3 * 24 * 60 * 60 * 1000), // 3일 전
        updatedAt: new Date(baseDate.getTime() - 1 * 24 * 60 * 60 * 1000), // 1일 전
        pullRequestUrls: [
          'https://github.com/example/ai-devteam/pull/1'
        ],
        metadata: undefined
      },
      {
        id: `${boardId}-item-2`,
        title: 'Implement core interfaces',
        description: 'Define TypeScript interfaces for task, worker, and service abstractions',
        status: 'DONE',
        priority: 'HIGH',
        assignee: 'claude-dev',
        labels: ['types', 'interfaces', 'core'],
        createdAt: new Date(baseDate.getTime() - 2 * 24 * 60 * 60 * 1000), // 2일 전
        updatedAt: new Date(baseDate.getTime() - 6 * 60 * 60 * 1000), // 6시간 전
        pullRequestUrls: [
          'https://github.com/example/ai-devteam/pull/2'
        ],
        metadata: undefined
      },
      {
        id: `${boardId}-item-3`,
        title: 'Create state management system',
        description: 'Implement JSON-based state persistence for tasks and workers',
        status: 'TODO',
        priority: 'HIGH',
        assignee: 'gemini-dev',
        labels: ['state', 'persistence', 'json'],
        createdAt: new Date(baseDate.getTime() - 1 * 24 * 60 * 60 * 1000), // 1일 전
        updatedAt: new Date(baseDate.getTime() - 2 * 60 * 60 * 1000), // 2시간 전
        pullRequestUrls: [],
        metadata: undefined
      },
      {
        id: `${boardId}-item-4`,
        title: 'Implement task planner',
        description: 'Create intelligent task planning and distribution system',
        status: 'TODO',
        priority: 'HIGH',
        assignee: null,
        labels: ['planner', 'ai', 'task-distribution'],
        createdAt: new Date(baseDate.getTime() - 12 * 60 * 60 * 1000), // 12시간 전
        updatedAt: new Date(baseDate.getTime() - 12 * 60 * 60 * 1000), // 12시간 전
        pullRequestUrls: [],
        metadata: undefined
      },
      {
        id: `${boardId}-item-5`,
        title: 'Add logging system',
        description: 'Implement comprehensive logging for debugging and monitoring',
        status: 'TODO',
        priority: 'MEDIUM',
        assignee: null,
        labels: ['logging', 'monitoring', 'debugging'],
        createdAt: new Date(baseDate.getTime() - 6 * 60 * 60 * 1000), // 6시간 전
        updatedAt: new Date(baseDate.getTime() - 6 * 60 * 60 * 1000), // 6시간 전
        pullRequestUrls: [],
        metadata: undefined
      },
      {
        id: `${boardId}-item-6`,
        title: 'Worker monitoring system',
        description: 'Implement worker health monitoring and recovery',
        status: 'TODO',
        priority: 'MEDIUM',
        assignee: null,
        labels: ['monitoring', 'worker', 'health-check'],
        createdAt: new Date(baseDate.getTime() - 4 * 60 * 60 * 1000), // 4시간 전
        updatedAt: new Date(baseDate.getTime() - 4 * 60 * 60 * 1000), // 4시간 전
        pullRequestUrls: [],
        metadata: undefined
      },
      {
        id: `${boardId}-item-7`,
        title: 'Task reassignment logic',
        description: 'Implement automatic task reassignment on worker failure',
        status: 'TODO',
        priority: 'HIGH',
        assignee: null,
        labels: ['reassignment', 'worker', 'failover'],
        createdAt: new Date(baseDate.getTime() - 3 * 60 * 60 * 1000), // 3시간 전
        updatedAt: new Date(baseDate.getTime() - 3 * 60 * 60 * 1000), // 3시간 전
        pullRequestUrls: [],
        metadata: undefined
      },
      {
        id: `${boardId}-item-8`,
        title: 'Error handling improvements',
        description: 'Enhance error handling and retry mechanisms',
        status: 'TODO',
        priority: 'MEDIUM',
        assignee: null,
        labels: ['error-handling', 'retry', 'resilience'],
        createdAt: new Date(baseDate.getTime() - 2 * 60 * 60 * 1000), // 2시간 전
        updatedAt: new Date(baseDate.getTime() - 2 * 60 * 60 * 1000), // 2시간 전
        pullRequestUrls: [],
        metadata: undefined
      }
    ];
  }
}
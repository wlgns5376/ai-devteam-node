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

  async setPullRequestToItem(itemId: string, pullRequestUrl: string): Promise<ProjectBoardItem> {
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
          status: item.status,
          priority: item.priority,
          assignee: item.assignee,
          labels: item.labels,
          createdAt: item.createdAt,
          updatedAt: new Date(),
          pullRequestUrls: [pullRequestUrl], // 기존 URL을 모두 교체
          metadata: item.metadata
        };
        boardItems[itemIndex] = updatedItem;
        return updatedItem;
      }
    }

    throw new Error(`Item not found: ${itemId}`);
  }

  // 테스트용 작업 추가 메서드
  addTestTask(taskId: string, boardId: string = 'test-board'): void {
    let boardItems = this.items.get(boardId);
    if (!boardItems) {
      boardItems = [];
      this.items.set(boardId, boardItems);
    }

    // 이미 존재하는지 확인
    const existingItem = boardItems.find(item => item.id === taskId);
    if (existingItem) {
      return;
    }

    // 새로운 테스트 작업 생성
    const newItem: ProjectBoardItem = {
      id: taskId,
      title: `Test Task: ${taskId}`,
      description: `Test task for E2E integration testing: ${taskId}`,
      status: 'TODO',
      priority: 'MEDIUM',
      assignee: 'test-user',
      labels: ['test', 'e2e'],
      createdAt: new Date(),
      updatedAt: new Date(),
      pullRequestUrls: [],
      metadata: {
        testTask: true,
        createdBy: 'integration-test',
        repository: 'test-owner/test-repo'
      }
    };

    boardItems.push(newItem);
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
        status: 'IN_PROGRESS',
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
      },
      {
        id: `${boardId}-item-9`,
        title: 'Performance optimization',
        description: 'Optimize system performance and resource usage',
        status: 'TODO',
        priority: 'MEDIUM',
        assignee: null,
        labels: ['performance', 'optimization'],
        createdAt: new Date(baseDate.getTime() - 1 * 60 * 60 * 1000), // 1시간 전
        updatedAt: new Date(baseDate.getTime() - 1 * 60 * 60 * 1000), // 1시간 전
        pullRequestUrls: [],
        metadata: undefined
      },
      {
        id: `${boardId}-item-10`,
        title: 'Security enhancements',
        description: 'Implement security best practices and vulnerability fixes',
        status: 'TODO',
        priority: 'HIGH',
        assignee: null,
        labels: ['security', 'vulnerability'],
        createdAt: new Date(baseDate.getTime() - 30 * 60 * 1000), // 30분 전
        updatedAt: new Date(baseDate.getTime() - 30 * 60 * 1000), // 30분 전
        pullRequestUrls: [],
        metadata: undefined
      },
      {
        id: `${boardId}-item-11`,
        title: 'Documentation update',
        description: 'Update project documentation and API reference',
        status: 'TODO',
        priority: 'LOW',
        assignee: null,
        labels: ['documentation', 'api'],
        createdAt: new Date(baseDate.getTime() - 15 * 60 * 1000), // 15분 전
        updatedAt: new Date(baseDate.getTime() - 15 * 60 * 1000), // 15분 전
        pullRequestUrls: [],
        metadata: undefined
      },
      {
        id: `${boardId}-item-12`,
        title: 'Testing framework',
        description: 'Implement comprehensive testing framework',
        status: 'TODO',
        priority: 'HIGH',
        assignee: null,
        labels: ['testing', 'framework'],
        createdAt: new Date(baseDate.getTime() - 10 * 60 * 1000), // 10분 전
        updatedAt: new Date(baseDate.getTime() - 10 * 60 * 1000), // 10분 전
        pullRequestUrls: [],
        metadata: undefined
      },
      {
        id: `${boardId}-item-13`,
        title: 'Deployment automation',
        description: 'Automate deployment process with CI/CD pipeline',
        status: 'TODO',
        priority: 'MEDIUM',
        assignee: null,
        labels: ['deployment', 'automation', 'cicd'],
        createdAt: new Date(baseDate.getTime() - 5 * 60 * 1000), // 5분 전
        updatedAt: new Date(baseDate.getTime() - 5 * 60 * 1000), // 5분 전
        pullRequestUrls: [],
        metadata: undefined
      }
    ];
  }
}
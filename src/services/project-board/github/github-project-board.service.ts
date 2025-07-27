import { ProjectBoard, ProjectBoardItem, ProjectBoardService } from '@/types';
import { Logger } from '@/services/logger';
import { GitHubApiClient } from './github-api-client';
import { 
  GitHubProjectConfig, 
  GitHubProject, 
  GitHubColumn, 
  GitHubCard,
  GitHubApiError,
  STATUS_MAPPING,
  PlannerStatus,
  GitHubColumnName
} from './types';

export class GitHubProjectBoardService implements ProjectBoardService {
  private apiClient: GitHubApiClient;
  private projectId: number | null = null;
  private columnMap: Map<string, number> = new Map();
  private reverseColumnMap: Map<number, string> = new Map();

  constructor(
    private readonly config: GitHubProjectConfig,
    private readonly logger: Logger
  ) {
    this.apiClient = new GitHubApiClient(this.config.token);
  }

  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing GitHub Project Board Service', {
        owner: this.config.owner,
        repo: this.config.repo,
        projectNumber: this.config.projectNumber
      });

      // プロジェクト찾기
      const project = await this.findProject();
      if (!project) {
        throw new Error('Project not found');
      }

      this.projectId = project.id;

      // 컬럼 매핑 로드
      await this.loadColumnMappings();

      this.logger.info('GitHub Project Board Service initialized', {
        projectId: this.projectId,
        columns: Array.from(this.columnMap.entries())
      });
    } catch (error) {
      this.logger.error('Failed to initialize GitHub Project Board Service', { error });
      throw error;
    }
  }

  private async findProject(): Promise<GitHubProject | null> {
    try {
      const response = await this.apiClient.listProjects(
        this.config.owner,
        this.config.repo,
        'open'
      );
      const projects = response.data;

      if (this.config.projectNumber) {
        return (projects.find((p: any) => p.number === this.config.projectNumber) as GitHubProject) || null;
      }

      return (projects[0] as GitHubProject) || null;
    } catch (error) {
      throw this.handleApiError(error, 'Failed to list projects');
    }
  }

  private async loadColumnMappings(): Promise<void> {
    if (!this.projectId) {
      throw new Error('Project ID not set');
    }

    try {
      const response = await this.apiClient.listColumns(this.projectId);
      const columns = response.data;

      this.columnMap.clear();
      this.reverseColumnMap.clear();

      // STATUS_MAPPING을 사용하여 Planner 상태와 GitHub 컬럼 매핑
      for (const [plannerStatus, githubColumnName] of Object.entries(STATUS_MAPPING)) {
        const column = columns.find((c: any) => c.name.toLowerCase() === githubColumnName.toLowerCase());
        if (column) {
          this.columnMap.set(plannerStatus, column.id);
          this.reverseColumnMap.set(column.id, plannerStatus);
        }
      }

      this.logger.debug('Column mappings loaded', {
        mappings: Array.from(this.columnMap.entries())
      });
    } catch (error) {
      throw this.handleApiError(error, 'Failed to load column mappings');
    }
  }

  async getBoard(boardId: string): Promise<ProjectBoard> {
    try {
      if (!this.projectId) {
        await this.initialize();
      }

      const response = await this.apiClient.getProject(parseInt(boardId));
      const project = response.data;

      return {
        id: String(project.id),
        name: project.name,
        description: project.body || '',
        url: project.html_url,
        createdAt: new Date(project.created_at),
        updatedAt: new Date(project.updated_at)
      };
    } catch (error) {
      throw this.handleApiError(error, 'Failed to get project board');
    }
  }

  async getItems(boardId: string, status?: string): Promise<ReadonlyArray<ProjectBoardItem>> {
    try {
      if (!this.projectId) {
        await this.initialize();
      }

      const items: ProjectBoardItem[] = [];

      if (status) {
        // 특정 상태의 아이템만 조회
        const columnId = this.columnMap.get(status);
        if (!columnId) {
          this.logger.warn('Unknown status mapping', { status });
          return [];
        }

        const cards = await this.getCardsFromColumn(columnId);
        items.push(...cards.map(card => this.mapCardToItem(card, status)));
      } else {
        // 모든 컬럼의 아이템 조회
        for (const [plannerStatus, columnId] of this.columnMap.entries()) {
          const cards = await this.getCardsFromColumn(columnId);
          items.push(...cards.map(card => this.mapCardToItem(card, plannerStatus)));
        }
      }

      return items;
    } catch (error) {
      throw this.handleApiError(error, 'Failed to get items');
    }
  }

  private async getCardsFromColumn(columnId: number): Promise<GitHubCard[]> {
    try {
      const response = await this.apiClient.listCards(columnId, 'not_archived');
      return response.data as GitHubCard[];
    } catch (error) {
      throw this.handleApiError(error, `Failed to get cards from column ${columnId}`);
    }
  }

  private mapCardToItem(card: GitHubCard, status: string): ProjectBoardItem {
    const pullRequestUrls = this.extractPullRequestUrls(card.note || '');
    const title = this.extractTitle(card.note || '');

    return {
      id: String(card.id),
      title,
      description: card.note || undefined,
      status,
      priority: undefined,
      assignee: null,
      labels: [],
      createdAt: new Date(card.created_at),
      updatedAt: new Date(card.updated_at),
      pullRequestUrls,
      metadata: {
        archived: card.archived,
        columnUrl: card.column_url,
        contentUrl: card.content_url
      }
    };
  }

  private extractTitle(note: string): string {
    // PR 링크 제거 후 첫 번째 줄을 제목으로 사용
    const lines = note.split('\n');
    const titleLine = lines.find(line => !line.startsWith('PR:') && line.trim() !== '');
    return titleLine?.trim() || 'Untitled';
  }

  private extractPullRequestUrls(note: string): string[] {
    const urls: string[] = [];
    const prRegex = /PR:\s*(https:\/\/github\.com\/[^\s]+\/pull\/\d+)/g;
    let match;

    while ((match = prRegex.exec(note)) !== null) {
      if (match[1]) {
        urls.push(match[1]);
      }
    }

    return urls;
  }

  async updateItemStatus(itemId: string, status: string): Promise<ProjectBoardItem> {
    try {
      const columnId = this.columnMap.get(status);
      if (!columnId) {
        throw new Error(`Invalid status: ${status}`);
      }

      await this.apiClient.moveCard(parseInt(itemId), columnId, 'top');

      // 업데이트된 카드 정보 조회
      const response = await this.apiClient.getCard(parseInt(itemId));
      const card = response.data;

      return this.mapCardToItem(card as GitHubCard, status);
    } catch (error) {
      throw this.handleApiError(error, 'Failed to update item status');
    }
  }

  async addPullRequestToItem(itemId: string, prUrl: string): Promise<void> {
    try {
      const response = await this.apiClient.getCard(parseInt(itemId));
      const card = response.data;

      // 이미 PR 링크가 있는지 확인
      if (card.note && card.note.includes(prUrl)) {
        this.logger.debug('PR link already exists', { itemId, prUrl });
        return;
      }

      const updatedNote = card.note
        ? `${card.note}\nPR: ${prUrl}`
        : `PR: ${prUrl}`;

      await this.apiClient.updateCard(parseInt(itemId), updatedNote);

      this.logger.info('Added PR link to item', { itemId, prUrl });
    } catch (error) {
      throw this.handleApiError(error, 'Failed to add PR link');
    }
  }

  private handleApiError(error: any, message: string): GitHubApiError {
    if (error.status) {
      const apiError = new GitHubApiError(
        `${message}: ${error.message}`,
        error.status,
        error
      );

      if (error.status === 429) {
        const resetTime = error.response?.headers?.['x-ratelimit-reset'];
        if (resetTime) {
          const resetDate = new Date(parseInt(resetTime) * 1000);
          this.logger.warn('GitHub API rate limit exceeded', {
            resetTime: resetDate.toISOString()
          });
        }
      }

      return apiError;
    }

    // 일반 에러인 경우 원본 에러 메시지 보존
    if (error instanceof Error) {
      return new GitHubApiError(`${message}: ${error.message}`, 0, error);
    }

    return new GitHubApiError(message, 0, error);
  }
}
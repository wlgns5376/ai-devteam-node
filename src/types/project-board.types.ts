export interface ProjectBoard {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly url: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProjectBoardItem {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly status: string;
  readonly priority?: string | undefined;
  readonly assignee: string | null;
  readonly labels: ReadonlyArray<string>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly pullRequestUrls: ReadonlyArray<string>;
  readonly contentNumber?: number | undefined;
  readonly contentType?: 'issue' | 'pull_request' | 'draft_issue' | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface ProjectBoardService {
  getBoard(boardId: string): Promise<ProjectBoard>;
  getItems(boardId: string, status?: string): Promise<ReadonlyArray<ProjectBoardItem>>;
  updateItemStatus(itemId: string, status: string): Promise<ProjectBoardItem>;
  addPullRequestToItem(itemId: string, prUrl: string): Promise<void>;
}
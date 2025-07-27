export interface GitHubProjectConfig {
  owner: string;
  repo: string;
  projectNumber?: number;
  token: string;
  apiVersion?: 'rest' | 'graphql';
}

export interface GitHubColumn {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubCard {
  id: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  column_url: string;
  content_url?: string;
  archived: boolean;
}

export interface GitHubProject {
  id: number;
  name: string;
  body: string | null;
  number: number;
  state: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  html_url: string;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly apiError: any
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export const STATUS_MAPPING = {
  'TODO': 'To do',
  'IN_PROGRESS': 'In progress',
  'IN_REVIEW': 'In review',
  'DONE': 'Done'
} as const;

export type PlannerStatus = keyof typeof STATUS_MAPPING;
export type GitHubColumnName = typeof STATUS_MAPPING[PlannerStatus];
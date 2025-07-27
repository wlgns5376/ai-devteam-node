/**
 * GitHub Projects v2 GraphQL API 타입 정의
 */

export interface ProjectV2Config {
  owner: string;
  projectNumber: number;
  token: string;
  repositoryFilter?: RepositoryFilterConfig;
}

export interface RepositoryFilterConfig {
  allowedRepositories?: string[]; // ["owner1/repo1", "owner2/repo2"]
  mode: 'whitelist' | 'blacklist';
}

// GraphQL 응답 타입들
export interface ProjectV2 {
  id: string;
  title: string;
  shortDescription?: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  closed: boolean;
  public: boolean;
}

export interface ProjectV2Item {
  id: string;
  type: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE';
  content?: ProjectV2ItemContent;
  fieldValues: {
    nodes: ProjectV2FieldValue[];
  };
}

export interface ProjectV2ItemContent {
  __typename: 'Issue' | 'PullRequest';
  id: string;
  number: number;
  title: string;
  state: string;
  url: string;
  repository: {
    owner: { login: string };
    name: string;
  };
  createdAt: string;
  updatedAt: string;
  body?: string;
  assignees?: {
    nodes: Array<{
      login: string;
      name?: string;
    }>;
  };
  labels?: {
    nodes: Array<{
      name: string;
      color: string;
    }>;
  };
}

export interface ProjectV2FieldValue {
  __typename: string;
  field: {
    __typename: string;
    name: string;
  };
}

export interface ProjectV2ItemFieldTextValue extends ProjectV2FieldValue {
  __typename: 'ProjectV2ItemFieldTextValue';
  text: string;
}

export interface ProjectV2ItemFieldSingleSelectValue extends ProjectV2FieldValue {
  __typename: 'ProjectV2ItemFieldSingleSelectValue';
  name: string;
  optionId: string;
}

export interface ProjectV2ItemFieldNumberValue extends ProjectV2FieldValue {
  __typename: 'ProjectV2ItemFieldNumberValue';
  number: number;
}

export interface ProjectV2ItemFieldDateValue extends ProjectV2FieldValue {
  __typename: 'ProjectV2ItemFieldDateValue';
  date: string;
}

export interface ProjectV2ItemFieldIterationValue extends ProjectV2FieldValue {
  __typename: 'ProjectV2ItemFieldIterationValue';
  title: string;
  startDate: string;
  duration: number;
}

// 페이지네이션 관련 타입들
export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

export interface ProjectV2ItemConnection {
  pageInfo: PageInfo;
  totalCount: number;
  nodes: ProjectV2Item[];
}

// 쿼리 응답 타입들
export interface GetProjectV2Response {
  organization?: {
    projectV2?: ProjectV2;
  };
  user?: {
    projectV2?: ProjectV2;
  };
}

export interface GetProjectV2ItemsResponse {
  node?: {
    items: ProjectV2ItemConnection;
  };
}

// 레포지토리 정보 추출용 타입
export interface RepositoryInfo {
  owner: string;
  name: string;
}

// 상태 매핑용 타입
export interface StatusFieldMapping {
  fieldName: string; // 프로젝트에서 상태 필드명 (예: "Status")
  statusValues: {
    TODO: string;
    IN_PROGRESS: string;
    IN_REVIEW: string;
    DONE: string;
  };
}

// 기본 상태 매핑
export const DEFAULT_STATUS_MAPPING: StatusFieldMapping = {
  fieldName: 'Status',
  statusValues: {
    TODO: 'Todo',
    IN_PROGRESS: 'In Progress',
    IN_REVIEW: 'In Review',
    DONE: 'Done'
  }
};

// GraphQL 에러 타입
export class GitHubProjectV2Error extends Error {
  constructor(
    message: string,
    public readonly projectNumber?: number,
    public readonly owner?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'GitHubProjectV2Error';
  }
}
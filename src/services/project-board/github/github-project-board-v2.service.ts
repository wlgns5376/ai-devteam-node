/**
 * GitHub Projects v2 GraphQL API 기반 ProjectBoardService 구현
 */

import { ProjectBoard, ProjectBoardItem, ProjectBoardService } from '@/types';
import { Logger } from '@/services/logger';
import { GitHubGraphQLClient, GitHubGraphQLError } from './github-graphql-client';
import { RepositoryFilter } from './repository-filter';
import {
  ProjectV2Config,
  ProjectV2,
  ProjectV2Item,
  ProjectV2ItemContent,
  ProjectV2FieldValue,
  ProjectV2ItemFieldSingleSelectValue,
  ProjectV2ItemFieldTextValue,
  ProjectV2ItemFieldPullRequestValue,
  GetProjectV2Response,
  GetProjectV2ItemsResponse,
  GitHubProjectV2Error,
  DEFAULT_STATUS_MAPPING,
  StatusFieldMapping
} from './graphql-types';
import {
  GET_ORGANIZATION_PROJECT_V2,
  GET_USER_PROJECT_V2,
  GET_PROJECT_V2_ITEMS,
  GET_PROJECT_V2_FIELDS,
  GET_PROJECT_V2_ITEM,
  UPDATE_PROJECT_V2_ITEM_FIELD_VALUE,
  GET_VIEWER
} from './graphql-queries';

export class GitHubProjectBoardV2Service implements ProjectBoardService {
  private graphqlClient: GitHubGraphQLClient;
  private projectId: string | null = null;
  private projectData: ProjectV2 | null = null;
  private statusMapping: StatusFieldMapping = DEFAULT_STATUS_MAPPING;
  private fieldMappings: Map<string, string> = new Map(); // fieldName -> fieldId
  private fieldOptions: Map<string, Map<string, string>> = new Map(); // fieldName -> optionName -> optionId

  constructor(
    private readonly config: ProjectV2Config,
    private readonly logger: Logger
  ) {
    this.graphqlClient = new GitHubGraphQLClient(this.config.token);
  }

  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing GitHub Projects v2 Service', {
        owner: this.config.owner,
        projectNumber: this.config.projectNumber
      });

      // 먼저 권한 확인
      await this.verifyPermissions();

      // 프로젝트 조회 시도 (조직 -> 사용자 순서)
      const project = await this.findProject();
      if (!project) {
        throw new GitHubProjectV2Error(
          `Project #${this.config.projectNumber} not found for owner "${this.config.owner}"`,
          this.config.projectNumber,
          this.config.owner
        );
      }

      this.projectId = project.id;
      this.projectData = project;

      // 프로젝트 필드 정보 로드
      await this.loadProjectFields();

      this.logger.info('GitHub Projects v2 Service initialized successfully', {
        projectId: this.projectId,
        projectTitle: project.title,
        fieldsLoaded: this.fieldMappings.size
      });
    } catch (error) {
      this.logger.error('Failed to initialize GitHub Projects v2 Service', { error });
      if (error instanceof GitHubProjectV2Error) {
        throw error;
      }
      throw new GitHubProjectV2Error(
        'Initialization failed',
        this.config.projectNumber,
        this.config.owner,
        error as Error
      );
    }
  }

  private async verifyPermissions(): Promise<void> {
    try {
      // Viewer 쿼리로 인증 및 기본 권한 확인
      const viewerResponse = await this.graphqlClient.query<{ viewer: { login: string; name?: string } }>(
        GET_VIEWER,
        {}
      );
      
      this.logger.info('GitHub API access verified', {
        user: viewerResponse.viewer.login
      });
    } catch (error) {
      this.logger.error('Failed to verify GitHub API permissions', {
        error: error instanceof Error ? {
          message: error.message,
          name: error.name
        } : error
      });
      
      throw new GitHubProjectV2Error(
        'Failed to verify GitHub API permissions. Please check your token has the required scopes: repo, project',
        this.config.projectNumber,
        this.config.owner,
        error as Error
      );
    }
  }

  private async findProject(): Promise<ProjectV2 | null> {
    try {
      // 먼저 조직 프로젝트로 시도
      try {
        const orgResponse = await this.graphqlClient.query<GetProjectV2Response>(
          GET_ORGANIZATION_PROJECT_V2,
          {
            owner: this.config.owner,
            projectNumber: this.config.projectNumber
          }
        );

        if (orgResponse.organization?.projectV2) {
          return orgResponse.organization.projectV2;
        }
      } catch (orgError) {
        // 조직 쿼리 실패시 User로 시도
        this.logger.debug('Organization query failed, trying user query', {
          owner: this.config.owner,
          error: orgError instanceof Error ? orgError.message : String(orgError)
        });
      }

      // 사용자 프로젝트로 시도
      const userResponse = await this.graphqlClient.query<GetProjectV2Response>(
        GET_USER_PROJECT_V2,
        {
          owner: this.config.owner,
          projectNumber: this.config.projectNumber
        }
      );

      return userResponse.user?.projectV2 || null;
    } catch (error) {
      if (error instanceof GitHubGraphQLError) {
        throw new GitHubProjectV2Error(
          `Failed to find project: ${error.message}`,
          this.config.projectNumber,
          this.config.owner,
          error
        );
      }
      throw error;
    }
  }

  private async loadProjectFields(): Promise<void> {
    if (!this.projectId) {
      throw new GitHubProjectV2Error('Project ID not set');
    }

    try {
      const response = await this.graphqlClient.query<any>(
        GET_PROJECT_V2_FIELDS,
        { projectId: this.projectId }
      );

      const fields = response.node?.fields?.nodes || [];
      this.fieldMappings.clear();
      this.fieldOptions.clear();

      fields.forEach((field: any) => {
        this.fieldMappings.set(field.name, field.id);
        
        // SingleSelectField인 경우 options도 저장
        if (field.dataType === 'SINGLE_SELECT' && field.options) {
          const optionsMap = new Map<string, string>();
          field.options.forEach((option: any) => {
            optionsMap.set(option.name, option.id);
          });
          this.fieldOptions.set(field.name, optionsMap);
          
          this.logger.debug(`Field options loaded for ${field.name}`, {
            fieldName: field.name,
            options: Array.from(optionsMap.entries())
          });
        }
      });

      this.logger.debug('Project fields loaded', {
        fields: Array.from(this.fieldMappings.entries()),
        fieldsWithOptions: Array.from(this.fieldOptions.keys())
      });
    } catch (error) {
      throw new GitHubProjectV2Error(
        'Failed to load project fields',
        this.config.projectNumber,
        this.config.owner,
        error as Error
      );
    }
  }

  async getBoard(boardId: string): Promise<ProjectBoard> {
    if (!this.projectData) {
      await this.initialize();
    }

    if (!this.projectData) {
      throw new GitHubProjectV2Error('Project data not available');
    }

    return {
      id: this.projectData.id,
      name: this.projectData.title,
      description: this.projectData.shortDescription || '',
      url: this.projectData.url,
      createdAt: new Date(this.projectData.createdAt),
      updatedAt: new Date(this.projectData.updatedAt)
    };
  }

  async getItems(boardId: string, status?: string): Promise<ReadonlyArray<ProjectBoardItem>> {
    if (!this.projectId) {
      await this.initialize();
    }

    if (!this.projectId) {
      throw new GitHubProjectV2Error('Project not initialized');
    }

    try {
      // 모든 프로젝트 아이템 조회 (페이지네이션 처리)
      const allItems = await this.getAllProjectItems();

      // 레포지토리 필터링 적용
      const filteredItems = RepositoryFilter.filterItems(allItems, this.config.repositoryFilter);

      // 상태별 필터링 (요청된 경우)
      const statusFilteredItems = status 
        ? this.filterItemsByStatus(filteredItems, status)
        : filteredItems;

      // ProjectBoardItem으로 변환
      const projectBoardItems = statusFilteredItems.map(item => 
        this.mapProjectV2ItemToProjectBoardItem(item)
      );

      this.logger.debug('Retrieved project items', {
        total: allItems.length,
        afterRepositoryFilter: filteredItems.length,
        afterStatusFilter: statusFilteredItems.length,
        requestedStatus: status
      });

      return projectBoardItems;
    } catch (error) {
      this.logger.error('Failed to get project items', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        projectId: this.projectId
      });
      throw new GitHubProjectV2Error(
        'Failed to get project items',
        this.config.projectNumber,
        this.config.owner,
        error as Error
      );
    }
  }

  private async getProjectItem(itemId: string, retryCount = 0): Promise<ProjectV2Item> {
    const maxRetries = 3;
    const retryDelay = 1000; // 1초

    try {
      const response = await this.graphqlClient.query<any>(
        GET_PROJECT_V2_ITEM,
        { itemId }
      );

      const item = response.node;
      if (!item || item.__typename !== 'ProjectV2Item') {
        throw new GitHubProjectV2Error(
          `Project item not found: ${itemId}`,
          this.config.projectNumber,
          this.config.owner
        );
      }

      return item as ProjectV2Item;
    } catch (error) {
      // GitHub API 일시적 불일치 문제로 인한 재시도
      if (retryCount < maxRetries) {
        this.logger.warn(`Failed to retrieve project item, retrying (${retryCount + 1}/${maxRetries})`, {
          itemId,
          error: error instanceof Error ? error.message : 'Unknown error',
          retryAfterMs: retryDelay * (retryCount + 1)
        });

        await new Promise(resolve => setTimeout(resolve, retryDelay * (retryCount + 1)));
        return this.getProjectItem(itemId, retryCount + 1);
      }

      throw new GitHubProjectV2Error(
        `Failed to retrieve project item: ${itemId}`,
        this.config.projectNumber,
        this.config.owner,
        error as Error
      );
    }
  }

  private async getAllProjectItems(): Promise<ProjectV2Item[]> {
    if (!this.projectId) {
      throw new GitHubProjectV2Error('Project ID not set');
    }

    try {
      const allItems = await this.graphqlClient.queryWithPagination<{
        pageInfo: any;
        nodes: ProjectV2Item[];
      }>(
        GET_PROJECT_V2_ITEMS,
        { projectId: this.projectId },
        'node.items'
      );

      return allItems;
    } catch (error) {
      // 상세한 에러 로깅
      this.logger.error('GraphQL query failed in getAllProjectItems', {
        query: 'GET_PROJECT_V2_ITEMS',
        projectId: this.projectId,
        dataPath: 'node.items',
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error
      });
      
      throw new GitHubProjectV2Error(
        'Failed to retrieve all project items',
        this.config.projectNumber,
        this.config.owner,
        error as Error
      );
    }
  }

  private filterItemsByStatus(items: ProjectV2Item[], status: string): ProjectV2Item[] {
    const targetStatusValue = this.statusMapping.statusValues[status as keyof typeof this.statusMapping.statusValues];
    if (!targetStatusValue) {
      this.logger.warn('Unknown status requested', { status, availableStatuses: Object.keys(this.statusMapping.statusValues) });
      return [];
    }

    return items.filter(item => {
      const statusField = this.getFieldValue(item, this.statusMapping.fieldName);
      return statusField === targetStatusValue;
    });
  }

  private getFieldValue(item: ProjectV2Item, fieldName: string): string | null {
    const fieldValue = item.fieldValues.nodes.find(fv => 
      fv.field && 'name' in fv.field && fv.field.name === fieldName
    );

    if (!fieldValue) {
      return null;
    }

    switch (fieldValue.__typename) {
      case 'ProjectV2ItemFieldSingleSelectValue':
        return (fieldValue as ProjectV2ItemFieldSingleSelectValue).name;
      case 'ProjectV2ItemFieldTextValue':
        return (fieldValue as ProjectV2ItemFieldTextValue).text;
      default:
        return null;
    }
  }

  private mapProjectV2ItemToProjectBoardItem(item: ProjectV2Item): ProjectBoardItem {
    const content = item.content;
    const repoInfo = RepositoryFilter.extractRepositoryInfoFromItem(item);
    const status = this.getItemStatus(item);

    // Repository 정보 디버깅 로그
    if (content && (content.__typename === 'Issue' || content.__typename === 'PullRequest')) {
      this.logger.debug('Repository info extracted from item', {
        itemId: item.id,
        contentType: content.__typename,
        contentNumber: content.number,
        repository: content.repository ? `${content.repository.owner.login}/${content.repository.name}` : 'null',
        extractedRepoInfo: repoInfo ? `${repoInfo.owner}/${repoInfo.name}` : 'null'
      });
    }

    // 기본 아이템 정보
    let title = 'Untitled';
    let description: string | undefined;
    let url: string | undefined;
    let assignee: string | null = null;
    let labels: string[] = [];
    let createdAt = new Date();
    let updatedAt = new Date();
    let pullRequestUrls: string[] = [];
    let contentNumber: number | undefined;
    let contentType: 'issue' | 'pull_request' | 'draft_issue' | undefined;

    if (content) {
      if (content.__typename === 'Issue' || content.__typename === 'PullRequest') {
        title = content.title;
        description = content.body || undefined;
        url = content.url;
        createdAt = new Date(content.createdAt);
        updatedAt = new Date(content.updatedAt);
        contentNumber = content.number;
        contentType = content.__typename === 'Issue' ? 'issue' : 'pull_request';

        // Assignees 처리
        if (content.assignees?.nodes && content.assignees.nodes.length > 0) {
          assignee = content.assignees.nodes[0]?.login || null;
        }

        // Labels 처리
        if (content.labels?.nodes) {
          labels = content.labels.nodes.map(label => label.name);
        }

        // PR URL 처리
        pullRequestUrls = this.extractPullRequestUrls(item, content);
      } else if (content.__typename === 'DraftIssue') {
        title = content.title;
        description = content.body || undefined;
        createdAt = new Date(content.createdAt);
        updatedAt = new Date(content.updatedAt);
        contentType = 'draft_issue';

        if (content.assignees?.nodes && content.assignees.nodes.length > 0) {
          assignee = content.assignees.nodes[0]?.login || null;
        }
      }
    }

    return {
      id: item.id,
      title,
      description,
      status: status || 'TODO',
      priority: undefined, // Projects v2에서 우선순위 필드가 있다면 추가 구현 필요
      assignee,
      labels,
      createdAt,
      updatedAt,
      pullRequestUrls,
      contentNumber,
      contentType,
      metadata: {
        type: item.type,
        repository: repoInfo ? `${repoInfo.owner}/${repoInfo.name}` : null,
        url,
        projectV2ItemId: item.id
      }
    };
  }

  /**
   * 아이템에서 PR URL들을 추출
   * ProjectV2ItemFieldPullRequestValue와 timelineItems에서 PR 정보를 가져옴
   */
  private extractPullRequestUrls(item: ProjectV2Item, content: ProjectV2ItemContent): string[] {
    const prUrls: string[] = [];

    // 1. PullRequest 타입이면 자신의 URL 추가 (closed가 아닌 경우만)
    if (content.__typename === 'PullRequest' && content.url && content.state !== 'CLOSED') {
      prUrls.push(content.url);
    }

    // 2. PullRequestValue 필드에서 PR URL 추출
    const prFieldUrls = this.extractPullRequestUrlsFromFields(item);
    prUrls.push(...prFieldUrls);

    // 3. Issue의 timelineItems에서 연결된 PR URL 추출 (closed가 아닌 경우만)
    if (content.__typename === 'Issue' && content.timelineItems?.nodes) {
      const timelinePRs = content.timelineItems.nodes
        .filter(timelineItem => {
          // PullRequest인지 확인
          if (timelineItem.__typename === 'ConnectedEvent' && timelineItem.subject?.__typename === 'PullRequest') {
            return timelineItem.subject.state !== 'CLOSED';
          } else if (timelineItem.__typename === 'CrossReferencedEvent' && timelineItem.source?.__typename === 'PullRequest') {
            return timelineItem.source.state !== 'CLOSED';
          }
          return false;
        })
        .map(timelineItem => {
          if (timelineItem.__typename === 'ConnectedEvent' && timelineItem.subject) {
            return timelineItem.subject.url;
          } else if (timelineItem.__typename === 'CrossReferencedEvent' && timelineItem.source) {
            return timelineItem.source.url;
          }
          return null;
        })
        .filter((url): url is string => url !== null);
      
      prUrls.push(...timelinePRs);
    }

    // 중복 제거 후 반환
    return [...new Set(prUrls)];
  }

  /**
   * 프로젝트 필드에서 PullRequest URL들을 추출 (closed가 아닌 경우만)
   */
  private extractPullRequestUrlsFromFields(item: ProjectV2Item): string[] {
    const prUrls: string[] = [];

    for (const fieldValue of item.fieldValues.nodes) {
      if (fieldValue.__typename === 'ProjectV2ItemFieldPullRequestValue') {
        const prFieldValue = fieldValue as ProjectV2ItemFieldPullRequestValue;
        const fieldPRs = prFieldValue.pullRequests.nodes
          .filter(pr => pr.state !== 'CLOSED')
          .map(pr => pr.url);
        prUrls.push(...fieldPRs);
      }
    }

    return prUrls;
  }

  private getItemStatus(item: ProjectV2Item): string | null {
    const statusValue = this.getFieldValue(item, this.statusMapping.fieldName);
    if (!statusValue) {
      return null;
    }

    // 상태 값을 역매핑
    for (const [key, value] of Object.entries(this.statusMapping.statusValues)) {
      if (value === statusValue) {
        return key;
      }
    }

    return null;
  }

  async updateItemStatus(itemId: string, status: string): Promise<ProjectBoardItem> {
    if (!this.projectId) {
      await this.initialize();
    }

    if (!this.projectId) {
      throw new GitHubProjectV2Error('Project not initialized');
    }

    // 상태 값 매핑 - 먼저 검증하여 빠른 실패
    const statusValue = this.statusMapping.statusValues[status as keyof typeof this.statusMapping.statusValues];
    if (!statusValue) {
      throw new GitHubProjectV2Error(
        `Invalid status: ${status}. Available statuses: ${Object.keys(this.statusMapping.statusValues).join(', ')}`,
        this.config.projectNumber,
        this.config.owner
      );
    }

    // 업데이트 전 현재 상태 조회
    let beforeItem: ProjectBoardItem | null = null;
    try {
      const currentItem = await this.getProjectItem(itemId);
      beforeItem = this.mapProjectV2ItemToProjectBoardItem(currentItem);
      
      this.logger.debug('Status update requested', {
        itemId,
        currentStatus: beforeItem.status,
        requestedStatus: status,
        title: beforeItem.title
      });

      // 이미 요청된 상태와 같다면 업데이트 생략
      if (beforeItem.status === status) {
        this.logger.info('Status already matches requested status, skipping update', {
          itemId,
          status,
          title: beforeItem.title
        });
        return beforeItem;
      }
    } catch (error) {
      this.logger.warn('Failed to get current item status for comparison', {
        itemId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // 상태 필드 ID 조회
    const statusFieldId = this.fieldMappings.get(this.statusMapping.fieldName);
    if (!statusFieldId) {
      throw new GitHubProjectV2Error(
        `Status field "${this.statusMapping.fieldName}" not found in project`,
        this.config.projectNumber,
        this.config.owner
      );
    }

    // Status field의 option ID 조회
    const statusFieldOptions = this.fieldOptions.get(this.statusMapping.fieldName);
    if (!statusFieldOptions) {
      throw new GitHubProjectV2Error(
        `Status field options not found for "${this.statusMapping.fieldName}"`,
        this.config.projectNumber,
        this.config.owner
      );
    }

    const statusOptionId = statusFieldOptions.get(statusValue);
    if (!statusOptionId) {
      throw new GitHubProjectV2Error(
        `Status option "${statusValue}" not found in field "${this.statusMapping.fieldName}". Available options: ${Array.from(statusFieldOptions.keys()).join(', ')}`,
        this.config.projectNumber,
        this.config.owner
      );
    }

    try {
      this.logger.debug('Executing status update mutation', {
        itemId,
        projectId: this.projectId,
        fieldId: statusFieldId,
        statusValue,
        statusOptionId,
        requestedStatus: status
      });

      // GraphQL mutation 실행
      const mutationResponse = await this.graphqlClient.query(
        UPDATE_PROJECT_V2_ITEM_FIELD_VALUE,
        {
          projectId: this.projectId,
          itemId: itemId,
          fieldId: statusFieldId,
          value: {
            singleSelectOptionId: statusOptionId
          }
        }
      );

      this.logger.debug('Status update mutation response', {
        itemId,
        response: mutationResponse
      });

      // 업데이트된 아이템 정보 조회 및 검증
      let mappedItem: ProjectBoardItem;
      try {
        const updatedItem = await this.getProjectItem(itemId);
        mappedItem = this.mapProjectV2ItemToProjectBoardItem(updatedItem);

        // 상태 변경 검증
        if (mappedItem.status !== status) {
          this.logger.warn('Status update verification mismatch - may be GitHub API delay', {
            itemId,
            requestedStatus: status,
            actualStatus: mappedItem.status,
            beforeStatus: beforeItem?.status,
            title: mappedItem.title
          });
        } else {
          this.logger.info('Status updated successfully', {
            itemId,
            beforeStatus: beforeItem?.status,
            afterStatus: mappedItem.status,
            title: mappedItem.title
          });
        }

        return mappedItem;
      } catch (verificationError) {
        // 뮤테이션은 성공했지만 검증 조회 실패 - 부분 성공으로 처리
        this.logger.warn('Status update completed but verification failed - assuming success', {
          itemId,
          requestedStatus: status,
          beforeStatus: beforeItem?.status,
          mutationSuccessful: true,
          verificationError: verificationError instanceof Error ? verificationError.message : 'Unknown error'
        });

        // 기본 아이템 정보로 응답 (뮤테이션 성공을 기준으로)
        return {
          id: itemId,
          title: beforeItem?.title || 'Unknown',
          status: status, // 요청한 상태로 가정
          assignee: beforeItem?.assignee || null,
          labels: beforeItem?.labels || [],
          pullRequestUrls: beforeItem?.pullRequestUrls || [],
          createdAt: beforeItem?.createdAt || new Date(),
          updatedAt: new Date(),
          description: beforeItem?.description,
          priority: beforeItem?.priority,
          contentNumber: beforeItem?.contentNumber,
          contentType: beforeItem?.contentType,
          metadata: beforeItem?.metadata
        };
      }

    } catch (error) {
      this.logger.error('Failed to update item status', {
        itemId,
        requestedStatus: status,
        beforeStatus: beforeItem?.status,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      throw new GitHubProjectV2Error(
        `Failed to update item status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.config.projectNumber,
        this.config.owner,
        error as Error
      );
    }
  }

  async addPullRequestToItem(itemId: string, pullRequestUrl: string): Promise<ProjectBoardItem> {
    // GitHub Projects v2에서는 PR URL을 직접 아이템에 추가하는 것보다는
    // 아이템 자체가 PR과 연결되어 있는 경우가 많음
    // 현재로서는 Mock처럼 동작하도록 구현하고, 실제로는 아이템 조회만 수행
    try {
      this.logger.info('Adding PR URL to project item (note: actual linking depends on GitHub integration)', {
        itemId,
        pullRequestUrl
      });

      // 기존 아이템 정보를 가져와서 반환
      const items = await this.getItems(this.projectData!.id);
      const item = items.find(i => i.id === itemId);
      
      if (!item) {
        throw new Error(`Item not found: ${itemId}`);
      }

      // PR URL이 이미 있는지 확인
      const updatedPullRequestUrls = [...item.pullRequestUrls];
      if (!updatedPullRequestUrls.includes(pullRequestUrl)) {
        updatedPullRequestUrls.push(pullRequestUrl);
      }

      // GitHub Projects v2에서는 실제로 PR URL을 추가하는 것보다는
      // 아이템 자체를 PR과 연결하는 것이 일반적이므로
      // 여기서는 로그만 남기고 기존 아이템을 반환
      this.logger.info('PR URL association logged (GitHub Projects v2 handles PR linking automatically)', {
        itemId,
        pullRequestUrl,
        existingPrUrls: item.pullRequestUrls
      });

      return {
        ...item,
        pullRequestUrls: updatedPullRequestUrls,
        updatedAt: new Date()
      };

    } catch (error) {
      this.logger.error('Failed to add PR URL to item', {
        itemId,
        pullRequestUrl,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new GitHubProjectV2Error(
        `Failed to add PR URL to item: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.config.projectNumber,
        this.config.owner,
        error as Error
      );
    }
  }
}
/**
 * GitHub GraphQL API 클라이언트
 * Projects v2 전용 GraphQL 쿼리를 처리합니다.
 */

export interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
  }>;
}

export interface GraphQLRequest {
  query: string;
  variables?: Record<string, any> | undefined;
}

export class GitHubGraphQLError extends Error {
  constructor(
    message: string,
    public readonly errors: any[],
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'GitHubGraphQLError';
  }
}

export class GitHubGraphQLClient {
  private readonly baseUrl = 'https://api.github.com/graphql';

  constructor(private readonly token: string) {}

  async query<T>(query: string, variables?: Record<string, any>): Promise<T> {
    const request: GraphQLRequest = {
      query
    };
    
    if (variables !== undefined) {
      request.variables = variables;
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'ai-devteam-node'
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new GitHubGraphQLError(
          `HTTP ${response.status}: ${response.statusText}`,
          [],
          response.status
        );
      }

      const result = await response.json() as GraphQLResponse<T>;

      if (result.errors && result.errors.length > 0) {
        const errorMessage = result.errors.map(e => e.message).join(', ');
        throw new GitHubGraphQLError(
          `GraphQL Error: ${errorMessage}`,
          result.errors,
          200
        );
      }

      if (!result.data) {
        throw new GitHubGraphQLError(
          'GraphQL response contains no data',
          [],
          200
        );
      }

      return result.data;
    } catch (error) {
      if (error instanceof GitHubGraphQLError) {
        throw error;
      }

      if (error instanceof Error) {
        throw new GitHubGraphQLError(
          `Network error: ${error.message}`,
          [],
          0
        );
      }

      throw new GitHubGraphQLError(
        'Unknown error occurred',
        [],
        0
      );
    }
  }

  async queryWithPagination<T extends { pageInfo: PageInfo; nodes: any[] }>(
    query: string,
    variables: Record<string, any>,
    dataPath: string,
    maxItems?: number
  ): Promise<any[]> {
    const allNodes: any[] = [];
    let hasNextPage = true;
    let after: string | undefined;
    let itemsCollected = 0;

    while (hasNextPage && (!maxItems || itemsCollected < maxItems)) {
      const currentVariables = {
        ...variables,
        after,
        first: maxItems ? Math.min(100, maxItems - itemsCollected) : 100
      };

      const response = await this.query<any>(query, currentVariables);
      
      // dataPath를 사용하여 중첩된 객체에서 데이터 추출
      const data = this.getNestedValue(response, dataPath);
      
      if (!data || !data.nodes) {
        break;
      }

      allNodes.push(...data.nodes);
      itemsCollected += data.nodes.length;

      hasNextPage = data.pageInfo?.hasNextPage || false;
      after = data.pageInfo?.endCursor;
    }

    return allNodes;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}
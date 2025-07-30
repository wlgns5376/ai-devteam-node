/**
 * GitHubProjectBoardV2Service 단위 테스트
 */

import { GitHubProjectBoardV2Service } from '@/services/project-board/github/github-project-board-v2.service';
import { GitHubGraphQLClient } from '@/services/project-board/github/github-graphql-client';
import { Logger } from '@/services/logger';
import { ProjectV2Config, GitHubProjectV2Error } from '@/services/project-board/github/graphql-types';

// Mock 설정
jest.mock('@/services/project-board/github/github-graphql-client');
jest.mock('@/services/logger');

const MockedGitHubGraphQLClient = GitHubGraphQLClient as jest.MockedClass<typeof GitHubGraphQLClient>;
const MockedLogger = Logger as jest.MockedClass<typeof Logger>;

describe('GitHubProjectBoardV2Service', () => {
  let service: GitHubProjectBoardV2Service;
  let mockGraphQLClient: jest.Mocked<GitHubGraphQLClient>;
  let mockLogger: jest.Mocked<Logger>;
  let config: ProjectV2Config;

  beforeEach(() => {
    // Mock 초기화
    mockGraphQLClient = {
      query: jest.fn(),
      queryWithPagination: jest.fn(),
    } as any;

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    // Mock 인스턴스 반환 설정
    MockedGitHubGraphQLClient.mockImplementation(() => mockGraphQLClient);
    MockedLogger.createConsoleLogger = jest.fn().mockReturnValue(mockLogger);

    // 테스트 설정
    config = {
      token: 'test-token',
      owner: 'test-owner',
      projectNumber: 1,
      repositoryFilter: {
        allowedRepositories: ['test-owner/test-repo'],
        mode: 'whitelist'
      }
    };

    service = new GitHubProjectBoardV2Service(config, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('GraphQL 클라이언트와 설정을 초기화해야 한다', () => {
      // When: 서비스를 생성하면
      const newService = new GitHubProjectBoardV2Service(config, mockLogger);

      // Then: 인스턴스가 올바르게 생성되어야 함
      expect(newService).toBeInstanceOf(GitHubProjectBoardV2Service);
      expect(MockedGitHubGraphQLClient).toHaveBeenCalledWith('test-token');
    });
  });

  describe('initialize', () => {
    it('조직 프로젝트 초기화에 성공해야 한다', async () => {
      // Given: Mock 응답 설정
      const mockProject = {
        id: 'PVT_test123',
        title: 'Test Project',
        shortDescription: 'Test description',
        url: 'https://github.com/test-owner/projects/1',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z'
      };

      const mockFields = {
        node: {
          fields: {
            nodes: [
              { id: 'field1', name: 'Status' },
              { id: 'field2', name: 'Priority' }
            ]
          }
        }
      };

      mockGraphQLClient.query
        .mockResolvedValueOnce({
          viewer: { login: 'test-user', name: 'Test User' }
        })
        .mockResolvedValueOnce({
          organization: { projectV2: mockProject }
        })
        .mockResolvedValueOnce(mockFields);

      // When: 초기화를 실행하면
      await service.initialize();

      // Then: 올바른 쿼리가 호출되어야 함
      expect(mockGraphQLClient.query).toHaveBeenCalledTimes(3);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initializing GitHub Projects v2 Service',
        expect.objectContaining({
          owner: 'test-owner',
          projectNumber: 1
        })
      );
    });

    it('프로젝트를 찾을 수 없으면 오류를 발생시켜야 한다', async () => {
      // Given: 프로젝트가 없는 응답
      mockGraphQLClient.query
        .mockResolvedValueOnce({
          viewer: { login: 'test-user', name: 'Test User' }
        })
        .mockResolvedValueOnce({ organization: { projectV2: null } })
        .mockResolvedValueOnce({ user: { projectV2: null } });

      // When & Then: 초기화 시 오류가 발생해야 함
      await expect(service.initialize()).rejects.toThrow(
        'Project #1 not found for owner "test-owner"'
      );
    });
  });

  describe('getItems', () => {
    beforeEach(async () => {
      // 기본 초기화 Mock 설정
      const mockProject = {
        id: 'PVT_test123',
        title: 'Test Project',
        shortDescription: 'Test description',
        url: 'https://github.com/test-owner/projects/1',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z'
      };

      const mockFields = {
        node: {
          fields: {
            nodes: [
              { id: 'field1', name: 'Status' }
            ]
          }
        }
      };

      mockGraphQLClient.query
        .mockResolvedValueOnce({
          viewer: { login: 'test-user', name: 'Test User' }
        })
        .mockResolvedValueOnce({
          organization: { projectV2: mockProject }
        })
        .mockResolvedValueOnce(mockFields);

      await service.initialize();
      jest.clearAllMocks();
    });

    it('레포지토리 필터링과 함께 아이템을 조회해야 한다', async () => {
      // Given: Mock 아이템 데이터
      const mockItems = [
        {
          id: 'item1',
          type: 'ISSUE',
          content: {
            __typename: 'Issue',
            id: 'issue1',
            number: 1,
            title: 'Test Issue',
            state: 'OPEN',
            url: 'https://github.com/test-owner/test-repo/issues/1',
            body: 'Test description',
            repository: {
              owner: { login: 'test-owner' },
              name: 'test-repo'
            },
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-02T00:00:00Z',
            assignees: { nodes: [] },
            labels: { nodes: [] },
            timelineItems: { nodes: [] }
          },
          fieldValues: {
            nodes: [
              {
                field: { name: 'Status' },
                value: 'Todo'
              }
            ]
          }
        },
        {
          id: 'item2',
          type: 'ISSUE',
          content: {
            __typename: 'Issue',
            id: 'issue2',
            number: 2,
            title: 'Other Issue',
            state: 'OPEN',
            url: 'https://github.com/other-owner/other-repo/issues/2',
            body: 'Other description',
            repository: {
              owner: { login: 'other-owner' },
              name: 'other-repo'
            },
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-02T00:00:00Z',
            assignees: { nodes: [] },
            labels: { nodes: [] },
            timelineItems: { nodes: [] }
          },
          fieldValues: {
            nodes: [
              {
                field: { name: 'Status' },
                value: 'Todo'
              }
            ]
          }
        }
      ];

      mockGraphQLClient.queryWithPagination.mockResolvedValue(mockItems);

      // When: 아이템을 조회하면
      const result = await service.getItems('test-board');

      // Then: 필터링된 결과가 반환되어야 함
      expect(result).toHaveLength(1); // whitelist 모드에서 test-owner/test-repo만 허용
      expect(result[0]?.title).toBe('Test Issue');
      expect(result[0]?.metadata?.repository).toBe('test-owner/test-repo');
      expect(mockGraphQLClient.queryWithPagination).toHaveBeenCalledTimes(1);
    });

    it('Issue에 연결된 PR URL들을 반환해야 한다', async () => {
      // Given: 연결된 PR이 있는 Issue Mock 데이터
      const mockItemsWithPRs = [
        {
          id: 'item1',
          type: 'ISSUE',
          content: {
            __typename: 'Issue',
            id: 'issue1',
            number: 1,
            title: 'Test Issue with PRs',
            state: 'OPEN',
            url: 'https://github.com/test-owner/test-repo/issues/1',
            body: 'Test description',
            repository: {
              owner: { login: 'test-owner' },
              name: 'test-repo'
            },
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-02T00:00:00Z',
            assignees: { nodes: [] },
            labels: { nodes: [] },
            timelineItems: {
              nodes: [
                {
                  __typename: 'ConnectedEvent',
                  createdAt: '2023-01-02T00:00:00Z',
                  subject: {
                    __typename: 'PullRequest',
                    url: 'https://github.com/test-owner/test-repo/pull/10',
                    number: 10,
                    title: 'Fix for issue #1',
                    state: 'OPEN'
                  }
                },
                {
                  __typename: 'CrossReferencedEvent',
                  createdAt: '2023-01-03T00:00:00Z',
                  source: {
                    __typename: 'PullRequest',
                    url: 'https://github.com/test-owner/test-repo/pull/11',
                    number: 11,
                    title: 'Another fix for issue #1',
                    state: 'MERGED'
                  }
                },
                {
                  __typename: 'ConnectedEvent',
                  createdAt: '2023-01-04T00:00:00Z',
                  subject: {
                    __typename: 'PullRequest',
                    url: 'https://github.com/test-owner/test-repo/pull/10',
                    number: 10,
                    title: 'Fix for issue #1',
                    state: 'OPEN'
                  }
                }
              ]
            }
          },
          fieldValues: {
            nodes: [
              {
                field: { name: 'Status' },
                value: 'Todo'
              }
            ]
          }
        }
      ];

      mockGraphQLClient.queryWithPagination.mockResolvedValue(mockItemsWithPRs);

      // When: 아이템을 조회하면
      const result = await service.getItems('test-board');

      // Then: 연결된 PR URL들이 중복 제거되어 반환되어야 함
      expect(result).toHaveLength(1);
      expect(result[0]?.pullRequestUrls).toEqual([
        'https://github.com/test-owner/test-repo/pull/10',
        'https://github.com/test-owner/test-repo/pull/11'
      ]);
      expect(result[0]?.title).toBe('Test Issue with PRs');
    });

    it('PullRequest 타입 아이템의 경우 자신의 URL을 반환해야 한다', async () => {
      // Given: PullRequest 타입 Mock 데이터
      const mockPRItems = [
        {
          id: 'item1',
          type: 'PULL_REQUEST',
          content: {
            __typename: 'PullRequest',
            id: 'pr1',
            number: 15,
            title: 'Test PR',
            state: 'OPEN',
            url: 'https://github.com/test-owner/test-repo/pull/15',
            body: 'Test PR description',
            repository: {
              owner: { login: 'test-owner' },
              name: 'test-repo'
            },
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-02T00:00:00Z',
            assignees: { nodes: [] },
            labels: { nodes: [] }
          },
          fieldValues: {
            nodes: [
              {
                field: { name: 'Status' },
                value: 'In Progress'
              }
            ]
          }
        }
      ];

      mockGraphQLClient.queryWithPagination.mockResolvedValue(mockPRItems);

      // When: 아이템을 조회하면
      const result = await service.getItems('test-board');

      // Then: PR 자신의 URL이 pullRequestUrls에 포함되어야 함
      expect(result).toHaveLength(1);
      expect(result[0]?.pullRequestUrls).toEqual([
        'https://github.com/test-owner/test-repo/pull/15'
      ]);
      expect(result[0]?.title).toBe('Test PR');
    });

    it('ProjectV2ItemFieldPullRequestValue 필드에서 PR URL들을 반환해야 한다', async () => {
      // Given: PullRequestValue 필드가 있는 Mock 데이터
      const mockItemsWithPRField = [
        {
          id: 'item1',
          type: 'ISSUE',
          content: {
            __typename: 'Issue',
            id: 'issue1',
            number: 1,
            title: 'Issue with PR Field',
            state: 'OPEN',
            url: 'https://github.com/test-owner/test-repo/issues/1',
            body: 'Test description',
            repository: {
              owner: { login: 'test-owner' },
              name: 'test-repo'
            },
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-02T00:00:00Z',
            assignees: { nodes: [] },
            labels: { nodes: [] },
            timelineItems: { nodes: [] }
          },
          fieldValues: {
            nodes: [
              {
                __typename: 'ProjectV2ItemFieldSingleSelectValue',
                field: { name: 'Status' },
                name: 'Todo'
              },
              {
                __typename: 'ProjectV2ItemFieldPullRequestValue',
                field: { name: 'Pull Requests' },
                pullRequests: {
                  nodes: [
                    {
                      url: 'https://github.com/test-owner/test-repo/pull/20',
                      number: 20,
                      title: 'Fix issue #1',
                      state: 'OPEN',
                      repository: {
                        owner: { login: 'test-owner' },
                        name: 'test-repo'
                      }
                    },
                    {
                      url: 'https://github.com/test-owner/test-repo/pull/21',
                      number: 21,
                      title: 'Another fix for issue #1',
                      state: 'MERGED',
                      repository: {
                        owner: { login: 'test-owner' },
                        name: 'test-repo'
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      ];

      mockGraphQLClient.queryWithPagination.mockResolvedValue(mockItemsWithPRField);

      // When: 아이템을 조회하면
      const result = await service.getItems('test-board');

      // Then: PullRequestValue 필드의 PR URL들이 반환되어야 함
      expect(result).toHaveLength(1);
      expect(result[0]?.pullRequestUrls).toEqual([
        'https://github.com/test-owner/test-repo/pull/20',
        'https://github.com/test-owner/test-repo/pull/21'
      ]);
      expect(result[0]?.title).toBe('Issue with PR Field');
    });

    it('timelineItems와 PullRequestValue 필드를 모두 조합해서 PR URL들을 반환해야 한다', async () => {
      // Given: timelineItems와 PullRequestValue 필드 모두 있는 Mock 데이터
      const mockItemsWithBoth = [
        {
          id: 'item1',
          type: 'ISSUE',
          content: {
            __typename: 'Issue',
            id: 'issue1',
            number: 1,
            title: 'Issue with both timeline and field PRs',
            state: 'OPEN',
            url: 'https://github.com/test-owner/test-repo/issues/1',
            body: 'Test description',
            repository: {
              owner: { login: 'test-owner' },
              name: 'test-repo'
            },
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-02T00:00:00Z',
            assignees: { nodes: [] },
            labels: { nodes: [] },
            timelineItems: {
              nodes: [
                {
                  __typename: 'ConnectedEvent',
                  createdAt: '2023-01-02T00:00:00Z',
                  subject: {
                    __typename: 'PullRequest',
                    url: 'https://github.com/test-owner/test-repo/pull/25',
                    number: 25,
                    title: 'Timeline PR',
                    state: 'OPEN'
                  }
                }
              ]
            }
          },
          fieldValues: {
            nodes: [
              {
                __typename: 'ProjectV2ItemFieldSingleSelectValue',
                field: { name: 'Status' },
                name: 'Todo'
              },
              {
                __typename: 'ProjectV2ItemFieldPullRequestValue',
                field: { name: 'Pull Requests' },
                pullRequests: {
                  nodes: [
                    {
                      url: 'https://github.com/test-owner/test-repo/pull/30',
                      number: 30,
                      title: 'Field PR',
                      state: 'MERGED',
                      repository: {
                        owner: { login: 'test-owner' },
                        name: 'test-repo'
                      }
                    },
                    {
                      url: 'https://github.com/test-owner/test-repo/pull/25',
                      number: 25,
                      title: 'Duplicate PR (should be deduplicated)',
                      state: 'OPEN',
                      repository: {
                        owner: { login: 'test-owner' },
                        name: 'test-repo'
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      ];

      mockGraphQLClient.queryWithPagination.mockResolvedValue(mockItemsWithBoth);

      // When: 아이템을 조회하면
      const result = await service.getItems('test-board');

      // Then: 두 소스의 PR URL들이 중복 제거되어 조합되어야 함
      expect(result).toHaveLength(1);
      expect(result[0]?.pullRequestUrls).toEqual([
        'https://github.com/test-owner/test-repo/pull/30',
        'https://github.com/test-owner/test-repo/pull/25'
      ]);
      expect(result[0]?.title).toBe('Issue with both timeline and field PRs');
    });

    it('closed 상태의 PR은 제외하고 반환해야 한다', async () => {
      // Given: CLOSED 상태의 PR을 포함한 Mock 데이터
      const mockItemsWithClosedPRs = [
        {
          id: 'item1',
          type: 'ISSUE',
          content: {
            __typename: 'Issue',
            id: 'issue1',
            number: 1,
            title: 'Issue with closed PRs',
            state: 'OPEN',
            url: 'https://github.com/test-owner/test-repo/issues/1',
            body: 'Test description',
            repository: {
              owner: { login: 'test-owner' },
              name: 'test-repo'
            },
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-02T00:00:00Z',
            assignees: { nodes: [] },
            labels: { nodes: [] },
            timelineItems: {
              nodes: [
                {
                  __typename: 'ConnectedEvent',
                  createdAt: '2023-01-02T00:00:00Z',
                  subject: {
                    __typename: 'PullRequest',
                    url: 'https://github.com/test-owner/test-repo/pull/40',
                    number: 40,
                    title: 'Open PR',
                    state: 'OPEN'
                  }
                },
                {
                  __typename: 'ConnectedEvent',
                  createdAt: '2023-01-03T00:00:00Z',
                  subject: {
                    __typename: 'PullRequest',
                    url: 'https://github.com/test-owner/test-repo/pull/41',
                    number: 41,
                    title: 'Closed PR (should be excluded)',
                    state: 'CLOSED'
                  }
                },
                {
                  __typename: 'CrossReferencedEvent',
                  createdAt: '2023-01-04T00:00:00Z',
                  source: {
                    __typename: 'PullRequest',
                    url: 'https://github.com/test-owner/test-repo/pull/42',
                    number: 42,
                    title: 'Merged PR',
                    state: 'MERGED'
                  }
                }
              ]
            }
          },
          fieldValues: {
            nodes: [
              {
                __typename: 'ProjectV2ItemFieldSingleSelectValue',
                field: { name: 'Status' },
                name: 'Todo'
              },
              {
                __typename: 'ProjectV2ItemFieldPullRequestValue',
                field: { name: 'Pull Requests' },
                pullRequests: {
                  nodes: [
                    {
                      url: 'https://github.com/test-owner/test-repo/pull/43',
                      number: 43,
                      title: 'Another Open PR',
                      state: 'OPEN',
                      repository: {
                        owner: { login: 'test-owner' },
                        name: 'test-repo'
                      }
                    },
                    {
                      url: 'https://github.com/test-owner/test-repo/pull/44',
                      number: 44,
                      title: 'Another Closed PR (should be excluded)',
                      state: 'CLOSED',
                      repository: {
                        owner: { login: 'test-owner' },
                        name: 'test-repo'
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      ];

      mockGraphQLClient.queryWithPagination.mockResolvedValue(mockItemsWithClosedPRs);

      // When: 아이템을 조회하면
      const result = await service.getItems('test-board');

      // Then: CLOSED 상태의 PR은 제외되고 OPEN, MERGED 상태의 PR만 반환되어야 함
      expect(result).toHaveLength(1);
      expect(result[0]?.pullRequestUrls).toEqual([
        'https://github.com/test-owner/test-repo/pull/43', // Field의 OPEN PR
        'https://github.com/test-owner/test-repo/pull/40', // Timeline의 OPEN PR
        'https://github.com/test-owner/test-repo/pull/42'  // Timeline의 MERGED PR
      ]);
      expect(result[0]?.title).toBe('Issue with closed PRs');
    });

    it('PullRequest 타입 아이템이 CLOSED 상태면 자신의 URL을 제외해야 한다', async () => {
      // Given: CLOSED 상태의 PullRequest 타입 Mock 데이터
      const mockClosedPRItems = [
        {
          id: 'item1',
          type: 'PULL_REQUEST',
          content: {
            __typename: 'PullRequest',
            id: 'pr1',
            number: 50,
            title: 'Closed PR',
            state: 'CLOSED',
            url: 'https://github.com/test-owner/test-repo/pull/50',
            body: 'This PR is closed',
            repository: {
              owner: { login: 'test-owner' },
              name: 'test-repo'
            },
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-02T00:00:00Z',
            assignees: { nodes: [] },
            labels: { nodes: [] }
          },
          fieldValues: {
            nodes: [
              {
                __typename: 'ProjectV2ItemFieldSingleSelectValue',
                field: { name: 'Status' },
                name: 'Done'
              }
            ]
          }
        }
      ];

      mockGraphQLClient.queryWithPagination.mockResolvedValue(mockClosedPRItems);

      // When: 아이템을 조회하면
      const result = await service.getItems('test-board');

      // Then: CLOSED 상태의 PR은 pullRequestUrls가 빈 배열이어야 함
      expect(result).toHaveLength(1);
      expect(result[0]?.pullRequestUrls).toEqual([]);
      expect(result[0]?.title).toBe('Closed PR');
    });
  });

  describe('updateItemStatus', () => {
    beforeEach(async () => {
      // 기본 초기화 Mock 설정
      const mockProject = {
        id: 'PVT_test123',
        title: 'Test Project',
        shortDescription: 'Test description',
        url: 'https://github.com/test-owner/projects/1',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z'
      };

      const mockFields = {
        node: {
          fields: {
            nodes: [
              { id: 'status-field-id', name: 'Status' }
            ]
          }
        }
      };

      mockGraphQLClient.query
        .mockResolvedValueOnce({
          viewer: { login: 'test-user', name: 'Test User' }
        })
        .mockResolvedValueOnce({
          organization: { projectV2: mockProject }
        })
        .mockResolvedValueOnce(mockFields);

      await service.initialize();
      jest.clearAllMocks();
    });

    it('유효하지 않은 상태로 업데이트 시 오류를 발생시켜야 한다', async () => {
      // When & Then: 잘못된 상태로 업데이트 시 오류가 발생해야 함
      await expect(service.updateItemStatus('item1', 'INVALID_STATUS'))
        .rejects.toThrow(GitHubProjectV2Error);
      await expect(service.updateItemStatus('item1', 'INVALID_STATUS'))
        .rejects.toThrow('Invalid status: INVALID_STATUS');
    });
  });

  describe('getBoard', () => {
    it('프로젝트 보드 정보를 반환해야 한다', async () => {
      // Given: Mock 프로젝트 데이터
      const mockProject = {
        id: 'PVT_test123',
        title: 'Test Project',
        shortDescription: 'Test description',
        url: 'https://github.com/test-owner/projects/1',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z'
      };

      const mockFields = {
        node: {
          fields: {
            nodes: [
              { id: 'field1', name: 'Status' }
            ]
          }
        }
      };

      mockGraphQLClient.query
        .mockResolvedValueOnce({
          viewer: { login: 'test-user', name: 'Test User' }
        })
        .mockResolvedValueOnce({
          organization: { projectV2: mockProject }
        })
        .mockResolvedValueOnce(mockFields);

      // When: 보드 정보를 조회하면
      const result = await service.getBoard('test-board');

      // Then: 올바른 보드 정보가 반환되어야 함
      expect(result).toEqual({
        id: 'PVT_test123',
        name: 'Test Project',
        description: 'Test description',
        url: 'https://github.com/test-owner/projects/1',
        createdAt: new Date('2023-01-01T00:00:00Z'),
        updatedAt: new Date('2023-01-02T00:00:00Z')
      });
    });
  });
});
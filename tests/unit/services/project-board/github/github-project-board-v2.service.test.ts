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
          organization: { projectV2: mockProject }
        })
        .mockResolvedValueOnce(mockFields);

      // When: 초기화를 실행하면
      await service.initialize();

      // Then: 올바른 쿼리가 호출되어야 함
      expect(mockGraphQLClient.query).toHaveBeenCalledTimes(2);
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
            labels: { nodes: [] }
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
            labels: { nodes: [] }
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
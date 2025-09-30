// Mock the SDK query function
const mockQuery = jest.fn();

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery
}));

// ContextFileManager mock
const mockCleanupContextFiles = jest.fn().mockResolvedValue(undefined);
const mockCreateWorkspaceContext = jest.fn().mockResolvedValue('/tmp/workspace-context.md');
const mockSplitLongContext = jest.fn().mockResolvedValue([]);
const mockShouldSplitContext = jest.fn().mockReturnValue(false);

jest.mock('@/services/developer/context-file-manager', () => ({
  ContextFileManager: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    createContextFile: jest.fn().mockResolvedValue('test-context-file.md'),
    createWorkspaceContext: mockCreateWorkspaceContext,
    cleanupContextFiles: mockCleanupContextFiles,
    getContextFilePath: jest.fn().mockReturnValue('/tmp/test-context.md'),
    splitLongContext: mockSplitLongContext,
    shouldSplitContext: mockShouldSplitContext,
    generateFileReference: jest.fn().mockImplementation((path, desc) => `@${path}`)
  }))
}));

import { ClaudeDeveloperSDK } from '@/services/developer/claude-developer-sdk';
import { Logger } from '@/services/logger';
import {
  DeveloperConfig,
  DeveloperOutput,
  DeveloperErrorCode,
  DeveloperError
} from '@/types/developer.types';

describe('ClaudeDeveloperSDK', () => {
  let developer: ClaudeDeveloperSDK;
  let mockLogger: Logger;
  let config: DeveloperConfig;

  beforeEach(() => {
    // Logger mock
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    } as any;

    // Config
    config = {
      timeoutMs: 60000,
      maxRetries: 3,
      retryDelayMs: 1000,
      useSDK: true,
      claude: {
        apiKey: 'test-api-key',
        model: 'claude-sonnet-4-5-20250929',
        maxTokens: 8192,
        temperature: 0.7
      }
    };

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('초기화 성공 - API 키 존재', async () => {
      // Given
      developer = new ClaudeDeveloperSDK(config, { logger: mockLogger });

      // When
      await developer.initialize();

      // Then
      expect(await developer.isAvailable()).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('Claude Developer SDK initialized with API key');
    });

    it('초기화 실패 - API 키 없음', async () => {
      // Given
      const configWithoutKey = { ...config, claude: undefined };
      developer = new ClaudeDeveloperSDK(configWithoutKey, { logger: mockLogger });

      // When & Then
      await expect(developer.initialize()).rejects.toThrow(DeveloperError);
      await expect(developer.initialize()).rejects.toMatchObject({
        code: DeveloperErrorCode.INITIALIZATION_FAILED,
        developerType: 'claude'
      });
    });
  });

  describe('executePrompt', () => {
    beforeEach(async () => {
      developer = new ClaudeDeveloperSDK(config, { logger: mockLogger });
      await developer.initialize();
    });

    it('프롬프트 실행 성공 - 기본 케이스', async () => {
      // Given
      const prompt = 'Test prompt';
      const workspaceDir = '/test/workspace';
      const expectedOutput = `
Successfully created files:
- src/test.ts
- tests/test.test.ts

All tests passing!
      `;

      // Mock SDK stream response
      const mockStream = (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: expectedOutput }]
          },
          uuid: 'test-uuid',
          session_id: 'test-session',
          parent_tool_use_id: null
        };
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '',
          uuid: 'test-uuid',
          session_id: 'test-session',
          duration_ms: 1000,
          duration_api_ms: 800,
          num_turns: 1,
          total_cost_usd: 0.01,
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          modelUsage: {},
          permission_denials: []
        };
      })();
      mockQuery.mockReturnValue(mockStream);

      // When
      const result: DeveloperOutput = await developer.executePrompt(prompt, workspaceDir);

      // Then
      expect(result.result.success).toBe(true);
      expect(result.rawOutput).toContain('Successfully created files');
      expect(result.metadata.developerType).toBe('claude');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt,
          options: expect.objectContaining({
            cwd: workspaceDir,
            model: 'claude-sonnet-4-5-20250929',
            allowedTools: expect.arrayContaining(['Bash', 'Read', 'Write', 'Edit'])
          })
        })
      );
    });

    it('프롬프트 실행 성공 - PR 링크 포함', async () => {
      // Given
      const prompt = 'Create a PR';
      const workspaceDir = '/test/workspace';
      const expectedOutput = `
Created PR: https://github.com/test/repo/pull/123
All changes committed successfully.
      `;

      const mockStream = (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: expectedOutput }]
          },
          uuid: 'test-uuid',
          session_id: 'test-session',
          parent_tool_use_id: null
        };
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '',
          uuid: 'test-uuid',
          session_id: 'test-session',
          duration_ms: 1000,
          duration_api_ms: 800,
          num_turns: 1,
          total_cost_usd: 0.01,
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          modelUsage: {},
          permission_denials: []
        };
      })();
      mockQuery.mockReturnValue(mockStream);

      // When
      const result = await developer.executePrompt(prompt, workspaceDir);

      // Then
      expect(result.result.success).toBe(true);
      expect(result.result.prLink).toBe('https://github.com/test/repo/pull/123');
    });

    it('프롬프트 실행 실패 - SDK 에러', async () => {
      // Given
      const prompt = 'Test prompt';
      const workspaceDir = '/test/workspace';

      const mockStream = (async function* () {
        yield {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          uuid: 'test-uuid',
          session_id: 'test-session',
          duration_ms: 1000,
          duration_api_ms: 800,
          num_turns: 1,
          total_cost_usd: 0.01,
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          modelUsage: {},
          permission_denials: []
        };
      })();
      mockQuery.mockReturnValue(mockStream);

      // When & Then
      await expect(developer.executePrompt(prompt, workspaceDir)).rejects.toThrow(DeveloperError);
    });

    it('프롬프트 실행 실패 - 타임아웃', async () => {
      // Given
      const prompt = 'Test prompt';
      const workspaceDir = '/test/workspace';
      const shortTimeoutConfig = { ...config, timeoutMs: 100 };
      developer = new ClaudeDeveloperSDK(shortTimeoutConfig, { logger: mockLogger });
      await developer.initialize();

      // Mock SDK stream that takes too long
      const mockStream = (async function* () {
        await new Promise(resolve => setTimeout(resolve, 1000));
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'response' }] },
          uuid: 'test-uuid',
          session_id: 'test-session',
          parent_tool_use_id: null
        };
      })();
      mockQuery.mockReturnValue(mockStream);

      // When & Then
      await expect(developer.executePrompt(prompt, workspaceDir)).rejects.toThrow(DeveloperError);
      await expect(developer.executePrompt(prompt, workspaceDir)).rejects.toMatchObject({
        code: DeveloperErrorCode.TIMEOUT
      });
    });

    it('초기화되지 않은 상태에서 실행 시도', async () => {
      // Given
      const uninitializedDeveloper = new ClaudeDeveloperSDK(config, { logger: mockLogger });

      // When & Then
      await expect(uninitializedDeveloper.executePrompt('test', '/workspace')).rejects.toThrow(
        DeveloperError
      );
      await expect(uninitializedDeveloper.executePrompt('test', '/workspace')).rejects.toMatchObject(
        {
          code: DeveloperErrorCode.NOT_AVAILABLE
        }
      );
    });
  });

  describe('cleanup', () => {
    beforeEach(async () => {
      developer = new ClaudeDeveloperSDK(config, { logger: mockLogger });
      await developer.initialize();
    });

    it('cleanup 성공', async () => {
      // Given
      const workspaceDir = '/test/workspace';
      const mockStream = (async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'test response' }] },
          uuid: 'test-uuid',
          session_id: 'test-session',
          parent_tool_use_id: null
        };
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '',
          uuid: 'test-uuid',
          session_id: 'test-session',
          duration_ms: 1000,
          duration_api_ms: 800,
          num_turns: 1,
          total_cost_usd: 0.01,
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          modelUsage: {},
          permission_denials: []
        };
      })();
      mockQuery.mockReturnValue(mockStream);

      // Execute to initialize context manager
      await developer.executePrompt('test', workspaceDir);

      // When
      await developer.cleanup();

      // Then
      expect(await developer.isAvailable()).toBe(false);
      expect(mockCleanupContextFiles).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Claude Developer SDK cleanup completed successfully'
      );
    });

    it('cleanup 실패 시에도 상태는 정리됨', async () => {
      // Given
      mockCleanupContextFiles.mockRejectedValueOnce(new Error('Cleanup failed'));

      // When & Then
      await expect(developer.cleanup()).rejects.toThrow();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to cleanup context files',
        expect.any(Object)
      );
    });
  });

  describe('setTimeout', () => {
    beforeEach(async () => {
      developer = new ClaudeDeveloperSDK(config, { logger: mockLogger });
      await developer.initialize();
    });

    it('타임아웃 설정', () => {
      // Given
      const newTimeout = 120000;

      // When
      developer.setTimeout(newTimeout);

      // Then
      expect(mockLogger.debug).toHaveBeenCalledWith('Claude Developer SDK timeout set', {
        timeoutMs: newTimeout
      });
    });
  });

  describe('긴 컨텍스트 처리', () => {
    beforeEach(async () => {
      developer = new ClaudeDeveloperSDK(config, { logger: mockLogger });
      await developer.initialize();
    });

    it('긴 컨텍스트를 분할하여 처리', async () => {
      // Given
      const longPrompt = 'a'.repeat(10000);
      const workspaceDir = '/test/workspace';

      mockShouldSplitContext.mockReturnValue(true);
      mockSplitLongContext.mockResolvedValue([
        { filePath: '/tmp/context-1.md', content: 'part1' },
        { filePath: '/tmp/context-2.md', content: 'part2' }
      ]);

      const mockStream = (async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'success' }] },
          uuid: 'test-uuid',
          session_id: 'test-session',
          parent_tool_use_id: null
        };
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '',
          uuid: 'test-uuid',
          session_id: 'test-session',
          duration_ms: 1000,
          duration_api_ms: 800,
          num_turns: 1,
          total_cost_usd: 0.01,
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          modelUsage: {},
          permission_denials: []
        };
      })();
      mockQuery.mockReturnValue(mockStream);

      // When
      const result = await developer.executePrompt(longPrompt, workspaceDir);

      // Then
      expect(result.result.success).toBe(true);
      expect(mockShouldSplitContext).toHaveBeenCalledWith(longPrompt);
      expect(mockSplitLongContext).toHaveBeenCalled();
    });
  });
});

import { ContextFileManager, ContextFileConfig } from '@/services/developer/context-file-manager';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
};

describe('ContextFileManager', () => {
  let contextFileManager: ContextFileManager;
  let tempDir: string;

  beforeEach(async () => {
    // 임시 디렉토리 생성
    tempDir = path.join(__dirname, '..', '..', '..', '..', 'temp-context-test');
    
    const config: ContextFileConfig = {
      maxContextLength: 100, // 테스트용으로 작은 크기
      contextDirectory: tempDir,
      enableMarkdownImports: true
    };

    contextFileManager = new ContextFileManager(config, { logger: mockLogger });
    await contextFileManager.initialize();
  });

  afterEach(async () => {
    // 임시 디렉토리 정리
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // 디렉토리가 없으면 무시
    }
  });

  describe('초기화', () => {
    it('컨텍스트 디렉토리를 생성해야 한다', async () => {
      const stats = await fs.stat(tempDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('초기화 로그를 출력해야 한다', () => {
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'ContextFileManager initialized',
        expect.objectContaining({
          contextDirectory: tempDir,
          maxContextLength: 100
        })
      );
    });
  });

  describe('컨텍스트 파일 생성', () => {
    it('컨텍스트 파일을 생성해야 한다', async () => {
      const content = 'This is test content for context file';
      
      const contextFile = await contextFileManager.createContextFile(content, 'context');
      
      expect(contextFile.id).toBeDefined();
      expect(contextFile.filePath).toContain('context-');
      expect(contextFile.content).toContain(content);
      expect(contextFile.metadata.type).toBe('context');
      expect(contextFile.metadata.size).toBeGreaterThan(0);
      
      // 파일이 실제로 생성되었는지 확인
      const fileExists = await fs.access(contextFile.filePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });

    it('구조화된 마크다운 형식으로 저장해야 한다', async () => {
      const content = 'Test content';
      
      const contextFile = await contextFileManager.createContextFile(content, 'reference');
      
      expect(contextFile.content).toContain('# Reference Context');
      expect(contextFile.content).toContain('> Generated:');
      expect(contextFile.content).toContain('> Type: reference');
      expect(contextFile.content).toContain('## Content');
      expect(contextFile.content).toContain(content);
    });
  });

  describe('워크스페이스 컨텍스트', () => {
    it('워크스페이스별 CLAUDE.local.md를 생성해야 한다', async () => {
      const workspaceDir = path.join(tempDir, 'test-workspace');
      await fs.mkdir(workspaceDir, { recursive: true });
      
      const taskInfo = {
        title: 'Test Task',
        description: 'This is a test task',
        requirements: ['Requirement 1', 'Requirement 2'],
        constraints: ['Constraint 1'],
        examples: ['Example code']
      };

      const claudeLocalPath = await contextFileManager.createWorkspaceContext(workspaceDir, taskInfo);
      
      expect(claudeLocalPath).toBe(path.join(workspaceDir, 'CLAUDE.local.md'));
      
      // 파일 내용 확인
      const content = await fs.readFile(claudeLocalPath, 'utf-8');
      expect(content).toContain('# Task Context: Test Task');
      expect(content).toContain('## Task Description');
      expect(content).toContain('This is a test task');
      expect(content).toContain('## Requirements');
      expect(content).toContain('- Requirement 1');
      expect(content).toContain('- Requirement 2');
      expect(content).toContain('## Constraints');
      expect(content).toContain('- Constraint 1');
      expect(content).toContain('## Examples');
      expect(content).toContain('Example code');
    });
  });

  describe('파일 참조 생성', () => {
    it('파일 참조 구문을 생성해야 한다', () => {
      const filePath = '/path/to/test/file.md';
      const reference = contextFileManager.generateFileReference(filePath);
      
      expect(reference).toContain('@');
      expect(reference).toContain('file.md');
    });

    it('설명이 있는 파일 참조 구문을 생성해야 한다', () => {
      const filePath = '/path/to/test/file.md';
      const description = 'Test file description';
      const reference = contextFileManager.generateFileReference(filePath, description);
      
      expect(reference).toContain('# Test file description');
      expect(reference).toContain('@');
    });
  });

  describe('컨텍스트 길이 관리', () => {
    it('컨텍스트 분리 필요성을 정확히 판단해야 한다', () => {
      const shortContent = 'Short content';
      const longContent = 'x'.repeat(150); // maxContextLength(100)보다 긴 내용
      
      expect(contextFileManager.shouldSplitContext(shortContent)).toBe(false);
      expect(contextFileManager.shouldSplitContext(longContent)).toBe(true);
    });

    it('긴 컨텍스트를 여러 파일로 분리해야 한다', async () => {
      const longContent = 'This is a very long content. '.repeat(10); // 길게 만들기
      
      const contextFiles = await contextFileManager.splitLongContext(longContent, 'context');
      
      expect(contextFiles.length).toBeGreaterThan(1); // 인덱스 파일 + 분리된 파일들
      expect(contextFiles[0]?.metadata.type).toBe('reference'); // 첫 번째는 인덱스
      
      // 모든 파일이 생성되었는지 확인
      for (const file of contextFiles) {
        const fileExists = await fs.access(file.filePath).then(() => true).catch(() => false);
        expect(fileExists).toBe(true);
      }
    });
  });

  describe('파일 정리', () => {
    it('오래된 컨텍스트 파일을 정리해야 한다', async () => {
      // 테스트 파일 생성
      const contextFile = await contextFileManager.createContextFile('Test content', 'context');
      
      // 파일 생성 확인
      let fileExists = await fs.access(contextFile.filePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
      
      // 미래 시간으로 정리 (모든 파일 삭제)
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await contextFileManager.cleanupContextFiles(futureDate);
      
      // 파일이 삭제되었는지 확인
      fileExists = await fs.access(contextFile.filePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(false);
    });

    it('정리 중 오류가 발생해도 안전하게 처리해야 한다', async () => {
      // 존재하지 않는 디렉토리로 설정하여 오류 유발
      const invalidConfig: ContextFileConfig = {
        maxContextLength: 100,
        contextDirectory: '/invalid/path/that/does/not/exist',
        enableMarkdownImports: true
      };
      
      const invalidManager = new ContextFileManager(invalidConfig, { logger: mockLogger });
      
      // 오류가 발생해도 예외가 던져지지 않아야 함
      await expect(invalidManager.cleanupContextFiles()).resolves.not.toThrow();
      
      // 경고 로그가 출력되어야 함
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Context file cleanup failed',
        expect.any(Object)
      );
    });
  });
});
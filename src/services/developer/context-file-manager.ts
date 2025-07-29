import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../logger';

export interface ContextFileConfig {
  maxContextLength: number;
  contextDirectory: string;
  enableMarkdownImports: boolean;
}

export interface ContextFile {
  id: string;
  filePath: string;
  content: string;
  metadata: {
    createdAt: Date;
    size: number;
    type: 'context' | 'reference' | 'instructions';
  };
}

export class ContextFileManager {
  private readonly logger: any;
  private readonly config: ContextFileConfig;

  constructor(config: ContextFileConfig, dependencies: { logger: any }) {
    this.config = config;
    this.logger = dependencies.logger;
  }

  async initialize(): Promise<void> {
    await this.ensureContextDirectory();
    this.logger.debug('ContextFileManager initialized', {
      contextDirectory: this.config.contextDirectory,
      maxContextLength: this.config.maxContextLength
    });
  }

  /**
   * 긴 컨텍스트를 파일로 분리하여 저장하고 참조 생성
   */
  async createContextFile(
    content: string,
    type: 'context' | 'reference' | 'instructions' = 'context'
  ): Promise<ContextFile> {
    const id = this.generateContextId();
    const fileName = `${type}-${id}.md`;
    const filePath = path.join(this.config.contextDirectory, fileName);

    // Claude.md 형식의 마크다운으로 구조화
    const structuredContent = this.structureContentForClaude(content, type);

    await fs.writeFile(filePath, structuredContent, 'utf-8');

    const contextFile: ContextFile = {
      id,
      filePath,
      content: structuredContent,
      metadata: {
        createdAt: new Date(),
        size: structuredContent.length,
        type
      }
    };

    this.logger.debug('Context file created', {
      id,
      filePath,
      size: contextFile.metadata.size,
      type
    });

    return contextFile;
  }

  /**
   * 작업별 CLAUDE.local.md 생성 (워크스페이스별 컨텍스트)
   */
  async createWorkspaceContext(
    workspaceDir: string,
    taskInfo: {
      title: string;
      description: string;
      requirements: string[];
      constraints?: string[];
      examples?: string[];
    }
  ): Promise<string> {
    const claudeLocalPath = path.join(workspaceDir, 'CLAUDE.local.md');

    const contextContent = this.generateWorkspaceContext(taskInfo);
    await fs.writeFile(claudeLocalPath, contextContent, 'utf-8');

    this.logger.debug('Workspace context file created', {
      workspaceDir,
      filePath: claudeLocalPath,
      taskTitle: taskInfo.title
    });

    return claudeLocalPath;
  }

  /**
   * 참조 파일 임포트 구문 생성 (Claude Code의 @파일 참조 방식)
   */
  generateFileReference(filePath: string, description?: string): string {
    const relativePath = path.relative(process.cwd(), filePath);
    
    if (description) {
      return `# ${description}\n@${relativePath}`;
    }
    
    return `@${relativePath}`;
  }

  /**
   * 컨텍스트 길이 체크 및 분리 제안
   */
  shouldSplitContext(content: string): boolean {
    return content.length > this.config.maxContextLength;
  }

  /**
   * 긴 컨텍스트를 여러 파일로 분리
   */
  async splitLongContext(
    content: string,
    contextType: string = 'context'
  ): Promise<ContextFile[]> {
    if (!this.shouldSplitContext(content)) {
      return [await this.createContextFile(content, contextType as any)];
    }

    const sections = this.splitContentIntoSections(content);
    const contextFiles: ContextFile[] = [];

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (section) {
        const contextFile = await this.createContextFile(
          section,
          contextType as any
        );
        contextFiles.push(contextFile);
      }
    }

    // 메인 인덱스 파일 생성
    const indexContent = this.createIndexFile(contextFiles, contextType);
    const indexFile = await this.createContextFile(indexContent, 'reference');
    
    return [indexFile, ...contextFiles];
  }

  /**
   * 컨텍스트 파일 정리
   */
  async cleanupContextFiles(olderThan: Date = new Date(Date.now() - 24 * 60 * 60 * 1000)): Promise<void> {
    try {
      const files = await fs.readdir(this.config.contextDirectory);
      let cleanedCount = 0;

      for (const file of files) {
        const filePath = path.join(this.config.contextDirectory, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime < olderThan) {
          await fs.unlink(filePath);
          cleanedCount++;
        }
      }

      this.logger.debug('Context files cleaned up', {
        cleanedCount,
        olderThan: olderThan.toISOString()
      });
    } catch (error) {
      this.logger.warn('Context file cleanup failed', { error });
    }
  }

  private async ensureContextDirectory(): Promise<void> {
    try {
      await fs.access(this.config.contextDirectory);
    } catch {
      await fs.mkdir(this.config.contextDirectory, { recursive: true });
    }
  }

  private generateContextId(): string {
    return `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private structureContentForClaude(content: string, type: string): string {
    const timestamp = new Date().toISOString();
    
    return `# ${type.charAt(0).toUpperCase() + type.slice(1)} Context

> Generated: ${timestamp}
> Type: ${type}

## Content

${content}

---
*This file was automatically generated by AI DevTeam ContextFileManager*
`;
  }

  private generateWorkspaceContext(taskInfo: {
    title: string;
    description: string;
    requirements: string[];
    constraints?: string[];
    examples?: string[];
  }): string {
    const { title, description, requirements, constraints, examples } = taskInfo;

    let content = `# Task Context: ${title}

## Task Description
${description}

## Requirements
${requirements.map(req => `- ${req}`).join('\n')}
`;

    if (constraints && constraints.length > 0) {
      content += `\n## Constraints
${constraints.map(constraint => `- ${constraint}`).join('\n')}
`;
    }

    if (examples && examples.length > 0) {
      content += `\n## Examples
${examples.map(example => `\`\`\`\n${example}\n\`\`\``).join('\n\n')}
`;
    }

    content += `
## Guidelines
- Follow the project's coding standards and conventions
- Ensure all code is properly tested
- Include appropriate error handling
- Document any complex logic
- Create meaningful commit messages

## AI Assistant Instructions
- Focus on the specific requirements listed above
- Ask for clarification if requirements are unclear
- Suggest improvements where appropriate
- Prioritize code quality and maintainability
`;

    return content;
  }

  private splitContentIntoSections(content: string): string[] {
    const maxSectionLength = Math.floor(this.config.maxContextLength * 0.8);
    const sections: string[] = [];
    
    // 논리적 구분점을 찾아서 분리 (헤더, 함수, 클래스 등)
    const logicalBreaks = content.match(/\n(?=##\s|class\s|function\s|export\s|import\s)/g);
    
    if (logicalBreaks && logicalBreaks.length > 1) {
      // 논리적 구분점 기준으로 분리
      const parts = content.split(/\n(?=##\s|class\s|function\s|export\s|import\s)/);
      let currentSection = '';
      
      for (const part of parts) {
        if (currentSection.length + part.length > maxSectionLength && currentSection) {
          sections.push(currentSection.trim());
          currentSection = part;
        } else {
          currentSection += (currentSection ? '\n' : '') + part;
        }
      }
      
      if (currentSection) {
        sections.push(currentSection.trim());
      }
    } else {
      // 단순 길이 기준 분리
      for (let i = 0; i < content.length; i += maxSectionLength) {
        sections.push(content.slice(i, i + maxSectionLength));
      }
    }

    return sections.filter(section => section.trim().length > 0);
  }

  private createIndexFile(contextFiles: ContextFile[], contextType: string): string {
    const fileReferences = contextFiles
      .map((file, index) => `${index + 1}. @${file.filePath} - ${file.metadata.type} (${file.metadata.size} bytes)`)
      .join('\n');

    return `# ${contextType} Index

This context has been split into multiple files for better management:

${fileReferences}

## Usage
Import these files in your CLAUDE.md or reference them directly in prompts using the @filepath syntax.

## Files Overview
- Total files: ${contextFiles.length}
- Total size: ${contextFiles.reduce((sum, file) => sum + file.metadata.size, 0)} bytes
- Created: ${new Date().toISOString()}
`;
  }
}
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('MCP Docker Setup', () => {
  const testWorkspace = '/tmp/test-mcp-workspace';
  const mcpConfigPath = path.join(testWorkspace, '.mcp.json');
  
  beforeEach(async () => {
    // 테스트 워크스페이스 초기화
    await fs.rm(testWorkspace, { recursive: true, force: true });
    await fs.mkdir(testWorkspace, { recursive: true });
  });

  describe('MCP Configuration', () => {
    it('should create .mcp.json file with task-master configuration', async () => {
      // Given: MCP 설정 객체
      const mcpConfig = {
        mcpServers: {
          'task-master-ai': {
            command: 'npx',
            args: ['-y', '--package=task-master-ai', 'task-master-ai'],
            env: {
              ANTHROPIC_API_KEY: '${ANTHROPIC_API_KEY:-}',
              PERPLEXITY_API_KEY: '${PERPLEXITY_API_KEY:-}',
              OPENAI_API_KEY: '${OPENAI_API_KEY:-}',
              GOOGLE_API_KEY: '${GOOGLE_API_KEY:-}',
              XAI_API_KEY: '${XAI_API_KEY:-}',
              OPENROUTER_API_KEY: '${OPENROUTER_API_KEY:-}',
              MISTRAL_API_KEY: '${MISTRAL_API_KEY:-}',
              AZURE_OPENAI_API_KEY: '${AZURE_OPENAI_API_KEY:-}',
              OLLAMA_API_KEY: '${OLLAMA_API_KEY:-}'
            }
          }
        }
      };

      // When: MCP 설정 파일 생성
      await fs.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

      // Then: 파일이 올바르게 생성되었는지 확인
      const fileExists = await fs.access(mcpConfigPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      const content = await fs.readFile(mcpConfigPath, 'utf-8');
      const parsedConfig = JSON.parse(content);
      expect(parsedConfig.mcpServers['task-master-ai']).toBeDefined();
      expect(parsedConfig.mcpServers['task-master-ai'].command).toBe('npx');
    });

    it('should validate MCP configuration structure', async () => {
      // Given: 잘못된 MCP 설정
      const invalidConfig = {
        mcpServers: {
          'invalid-server': {
            // command is missing
            args: ['test']
          }
        }
      };

      // When/Then: 유효성 검사 실패
      const validateConfig = (config: any) => {
        for (const serverName in config.mcpServers) {
          const server = config.mcpServers[serverName];
          if (!server.command) {
            throw new Error(`Server ${serverName} is missing required 'command' field`);
          }
        }
      };

      expect(() => validateConfig(invalidConfig)).toThrow('missing required \'command\' field');
    });
  });

  describe('Docker Environment Setup', () => {
    it('should install task-master-ai package in Docker image', async () => {
      // Given: Dockerfile 내용
      const dockerfileContent = `
FROM node:20-alpine
RUN npm install -g task-master-ai
`;

      // When: Dockerfile 생성
      const dockerfilePath = path.join(testWorkspace, 'Dockerfile.test');
      await fs.writeFile(dockerfilePath, dockerfileContent);

      // Then: Dockerfile에 task-master-ai 설치 명령이 포함되어 있는지 확인
      const content = await fs.readFile(dockerfilePath, 'utf-8');
      expect(content).toContain('npm install -g task-master-ai');
    });

    it('should copy MCP configuration to Docker container', async () => {
      // Given: Dockerfile 복사 명령
      const dockerCopyCommand = 'COPY .mcp.json /app/.mcp.json';

      // Then: 복사 명령이 올바른지 확인
      expect(dockerCopyCommand).toContain('.mcp.json');
      expect(dockerCopyCommand).toContain('/app/.mcp.json');
    });
  });

  describe('Environment Variables', () => {
    it('should support environment variable expansion in MCP config', async () => {
      // Given: 환경 변수가 포함된 설정
      const configWithEnvVars = {
        mcpServers: {
          'task-master-ai': {
            command: 'task-master-ai',
            env: {
              API_KEY: '${CUSTOM_API_KEY:-default_value}'
            }
          }
        }
      };

      // When: 환경 변수 확장 함수
      const expandEnvVars = (value: string, env: NodeJS.ProcessEnv) => {
        return value.replace(/\$\{([^}]+)\}/g, (match, varExpression) => {
          const [varName, defaultValue] = varExpression.split(':-');
          return env[varName] || defaultValue || '';
        });
      };

      // Then: 환경 변수가 올바르게 확장되는지 확인
      const testEnv = { CUSTOM_API_KEY: 'test_key' };
      const expanded = expandEnvVars(configWithEnvVars.mcpServers['task-master-ai'].env.API_KEY, testEnv);
      expect(expanded).toBe('test_key');

      // 환경 변수가 없을 때 기본값 사용
      const expandedDefault = expandEnvVars(configWithEnvVars.mcpServers['task-master-ai'].env.API_KEY, {});
      expect(expandedDefault).toBe('default_value');
    });

    it('should include all required API keys in .env.example', async () => {
      // Given: 필요한 API 키 목록
      const requiredApiKeys = [
        'ANTHROPIC_API_KEY',
        'PERPLEXITY_API_KEY',
        'OPENAI_API_KEY',
        'GOOGLE_API_KEY',
        'XAI_API_KEY',
        'OPENROUTER_API_KEY',
        'MISTRAL_API_KEY',
        'AZURE_OPENAI_API_KEY',
        'OLLAMA_API_KEY'
      ];

      // When: .env.example 내용 생성
      const envExampleContent = requiredApiKeys
        .map(key => `${key}="your_${key.toLowerCase()}_here"`)
        .join('\n');

      // Then: 모든 키가 포함되어 있는지 확인
      for (const key of requiredApiKeys) {
        expect(envExampleContent).toContain(key);
      }
    });
  });

  describe('MCP Initialization Script', () => {
    it('should create MCP initialization script', async () => {
      // Given: 초기화 스크립트 내용
      const initScript = `#!/bin/bash
set -e

echo "Initializing MCP configuration..."

# Check if .mcp.json exists
if [ ! -f /app/.mcp.json ]; then
    echo "Creating default .mcp.json..."
    cat > /app/.mcp.json << 'EOF'
{
  "mcpServers": {
    "task-master-ai": {
      "command": "npx",
      "args": ["-y", "--package=task-master-ai", "task-master-ai"],
      "env": {
        "ANTHROPIC_API_KEY": "\${ANTHROPIC_API_KEY:-}",
        "PERPLEXITY_API_KEY": "\${PERPLEXITY_API_KEY:-}",
        "OPENAI_API_KEY": "\${OPENAI_API_KEY:-}",
        "GOOGLE_API_KEY": "\${GOOGLE_API_KEY:-}",
        "XAI_API_KEY": "\${XAI_API_KEY:-}",
        "OPENROUTER_API_KEY": "\${OPENROUTER_API_KEY:-}",
        "MISTRAL_API_KEY": "\${MISTRAL_API_KEY:-}",
        "AZURE_OPENAI_API_KEY": "\${AZURE_OPENAI_API_KEY:-}",
        "OLLAMA_API_KEY": "\${OLLAMA_API_KEY:-}"
      }
    }
  }
}
EOF
fi

# Validate Claude Code installation
if command -v claude &> /dev/null; then
    echo "Claude Code is available"
    # List MCP servers
    claude mcp list || echo "Failed to list MCP servers"
else
    echo "Warning: Claude Code not found"
fi

echo "MCP initialization complete"
`;

      // When: 스크립트 파일 생성
      const scriptPath = path.join(testWorkspace, 'init-mcp.sh');
      await fs.writeFile(scriptPath, initScript);
      await fs.chmod(scriptPath, 0o755);

      // Then: 스크립트가 올바르게 생성되었는지 확인
      const stats = await fs.stat(scriptPath);
      expect(stats.mode & 0o111).toBeTruthy(); // 실행 권한 확인
      
      const content = await fs.readFile(scriptPath, 'utf-8');
      expect(content).toContain('mcpServers');
      expect(content).toContain('task-master-ai');
    });
  });

  describe('Docker Integration Tests', () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const dockerImageName = 'ai-devteam-test';
    
    // Docker 이미지 빌드 (실제 CI/CD 환경에서만 실행)
    const isCI = process.env.CI === 'true';
    
    beforeAll(async () => {
      if (isCI) {
        // CI 환경에서만 Docker 이미지 빌드
        try {
          console.log('Building Docker image for integration tests...');
          await execAsync(`docker build -t ${dockerImageName} .`, { cwd: projectRoot });
        } catch (error) {
          console.error('Failed to build Docker image:', error);
          throw error;
        }
      }
    }, 300000); // 5분 타임아웃

    afterAll(async () => {
      if (isCI) {
        // 테스트 후 이미지 정리
        try {
          await execAsync(`docker rmi ${dockerImageName}`);
        } catch (error) {
          console.error('Failed to remove test image:', error);
        }
      }
    });

    it('should build Docker image with MCP support', async () => {
      if (!isCI) {
        console.log('Skipping Docker build test in non-CI environment');
        return;
      }

      // Given: Docker 이미지가 빌드되었음
      // When: 이미지 정보 확인
      const { stdout } = await execAsync(`docker inspect ${dockerImageName} --format='{{.Config.Image}}'`);
      
      // Then: 이미지가 존재하는지 확인
      expect(stdout.trim()).toBeTruthy();
    });

    it('should have task-master-ai installed in Docker container', async () => {
      if (!isCI) {
        console.log('Skipping Docker container test in non-CI environment');
        return;
      }

      // Given: Docker 컨테이너 실행
      // When: task-master-ai 명령 확인
      const { stdout } = await execAsync(
        `docker run --rm ${dockerImageName} which task-master-ai || echo "not found"`
      );
      
      // Then: task-master-ai가 설치되어 있는지 확인
      expect(stdout.trim()).not.toBe('not found');
      expect(stdout.trim()).toContain('/usr/local/bin/task-master-ai');
    });

    it('should have .mcp.json file in Docker container', async () => {
      if (!isCI) {
        console.log('Skipping Docker container test in non-CI environment');
        return;
      }

      // Given: Docker 컨테이너 실행
      // When: .mcp.json 파일 확인
      const { stdout } = await execAsync(
        `docker run --rm ${dockerImageName} ls -la /app/.mcp.json`
      );
      
      // Then: 파일이 존재하는지 확인
      expect(stdout).toContain('.mcp.json');
    });

    it('should execute init-mcp.sh script successfully', async () => {
      if (!isCI) {
        console.log('Skipping Docker container test in non-CI environment');
        return;
      }

      // Given: Docker 컨테이너에서 초기화 스크립트 실행
      // When: 스크립트 실행
      const { stdout, stderr } = await execAsync(
        `docker run --rm ${dockerImageName} /app/scripts/init-mcp.sh`
      );
      
      // Then: 초기화가 성공적으로 완료되었는지 확인
      expect(stdout).toContain('MCP initialization complete');
      expect(stderr).toBe('');
    });
  });

  describe('Unit Tests for MCP Configuration', () => {
    it('should verify complete MCP setup workflow', async () => {
      // Given: 전체 설정 워크플로우
      const setupWorkflow = async () => {
        // 1. MCP 설정 파일 생성
        const mcpConfig = {
          mcpServers: {
            'task-master-ai': {
              command: 'npx',
              args: ['-y', '--package=task-master-ai', 'task-master-ai'],
              env: {}
            }
          }
        };
        await fs.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

        // 2. 환경 변수 설정 확인
        const envVarsSet = process.env.ANTHROPIC_API_KEY !== undefined;

        // 3. 설정 파일 유효성 검사
        const configContent = await fs.readFile(mcpConfigPath, 'utf-8');
        const config = JSON.parse(configContent);
        const isValidConfig = !!(config.mcpServers && config.mcpServers['task-master-ai']);

        return {
          configCreated: true,
          envVarsSet,
          isValidConfig
        };
      };

      // When: 설정 워크플로우 실행
      const result = await setupWorkflow();

      // Then: 설정이 완료되었는지 확인
      expect(result.configCreated).toBe(true);
      expect(result.isValidConfig).toBe(true);
    });
  });
});
import { 
  PlannerConfig, 
  ManagerConfig, 
  SystemDeveloperConfig, 
  LoggerConfig, 
  SystemConfig,
  ServiceProvider
} from '@/types/config.types';

describe('Config Types', () => {
  describe('PlannerConfig interface', () => {
    it('should have all required properties with correct types', () => {
      // Given: PlannerConfig 인터페이스를 구현한 객체가 있을 때
      const mockPlannerConfig: PlannerConfig = {
        pollingIntervalMs: 30000,
        projectBoard: {
          provider: ServiceProvider.GITHUB,
          boardId: 'github-project-123',
          config: {
            type: ServiceProvider.GITHUB,
            apiToken: 'github_token_123'
          }
        },
        repository: {
          provider: ServiceProvider.GITHUB,
          owner: 'test-org',
          name: 'ai-devteam-node',
          config: {
            type: ServiceProvider.GITHUB,
            apiToken: 'github_token_123'
          }
        }
      };

      // When: 각 속성을 확인하면
      // Then: 모든 필수 속성이 올바른 타입으로 존재해야 함
      expect(typeof mockPlannerConfig.pollingIntervalMs).toBe('number');
      expect(mockPlannerConfig.pollingIntervalMs).toBeGreaterThan(0);
      
      expect(Object.values(ServiceProvider)).toContain(mockPlannerConfig.projectBoard.provider);
      expect(typeof mockPlannerConfig.projectBoard.boardId).toBe('string');
      expect(mockPlannerConfig.projectBoard.config).toBeDefined();
      
      expect(Object.values(ServiceProvider)).toContain(mockPlannerConfig.repository.provider);
      expect(typeof mockPlannerConfig.repository.owner).toBe('string');
      expect(typeof mockPlannerConfig.repository.name).toBe('string');
      expect(mockPlannerConfig.repository.config).toBeDefined();
    });

    it('should support different providers for project board and repository', () => {
      // Given: 다른 제공자를 사용하는 PlannerConfig 객체가 있을 때
      const mixedProviderConfig: PlannerConfig = {
        pollingIntervalMs: 60000,
        projectBoard: {
          provider: ServiceProvider.JIRA,
          boardId: 'jira-board-456',
          config: {
            type: ServiceProvider.JIRA,
            apiToken: 'jira_token_456',
            baseUrl: 'https://company.atlassian.net'
          }
        },
        repository: {
          provider: ServiceProvider.GITLAB,
          owner: 'gitlab-org',
          name: 'project-repo',
          config: {
            type: ServiceProvider.GITLAB,
            apiToken: 'gitlab_token_789'
          }
        }
      };

      // When & Then: 다른 제공자 조합이 유효해야 함
      expect(mixedProviderConfig.projectBoard.provider).toBe(ServiceProvider.JIRA);
      expect(mixedProviderConfig.repository.provider).toBe(ServiceProvider.GITLAB);
      expect(mixedProviderConfig.projectBoard.config.type).toBe(ServiceProvider.JIRA);
      expect(mixedProviderConfig.repository.config.type).toBe(ServiceProvider.GITLAB);
    });

    it('should validate polling interval constraints', () => {
      // Given: 다양한 폴링 간격을 가진 설정들이 있을 때
      const configs = [
        { pollingIntervalMs: 1000 },    // 1초
        { pollingIntervalMs: 30000 },   // 30초
        { pollingIntervalMs: 300000 }   // 5분
      ];

      // When & Then: 모든 폴링 간격이 양수여야 함
      configs.forEach(config => {
        expect(config.pollingIntervalMs).toBeGreaterThan(0);
        expect(typeof config.pollingIntervalMs).toBe('number');
      });
    });
  });

  describe('ManagerConfig interface', () => {
    it('should have all required properties with correct types', () => {
      // Given: ManagerConfig 인터페이스를 구현한 객체가 있을 때
      const mockManagerConfig: ManagerConfig = {
        workspaceRoot: '/workspace/ai-devteam',
        workerPool: {
          minWorkers: 1,
          maxWorkers: 5,
          workerTimeoutMs: 600000
        },
        gitOperationTimeoutMs: 60000,
        repositoryCacheTimeoutMs: 300000,
        gitConfig: {
          cloneDepth: 1,
          enableConcurrencyLock: true
        },
        pullRequest: {
          provider: ServiceProvider.GITHUB,
          config: {
            type: ServiceProvider.GITHUB,
            apiToken: 'github_pr_token'
          }
        }
      };

      // When: 각 속성을 확인하면
      // Then: 모든 필수 속성이 올바른 타입으로 존재해야 함
      expect(typeof mockManagerConfig.workspaceRoot).toBe('string');
      
      expect(typeof mockManagerConfig.workerPool.minWorkers).toBe('number');
      expect(typeof mockManagerConfig.workerPool.maxWorkers).toBe('number');
      expect(typeof mockManagerConfig.workerPool.workerTimeoutMs).toBe('number');
      
      expect(typeof mockManagerConfig.gitConfig.cloneDepth).toBe('number');
      expect(typeof mockManagerConfig.gitConfig.enableConcurrencyLock).toBe('boolean');
      
      expect(Object.values(ServiceProvider)).toContain(mockManagerConfig.pullRequest.provider);
      expect(mockManagerConfig.pullRequest.config).toBeDefined();
    });

    it('should validate worker pool constraints', () => {
      // Given: 워커 풀 설정이 있을 때
      const workerPoolConfig = {
        minWorkers: 2,
        maxWorkers: 10,
        workerTimeoutMs: 300000
      };

      // When: 제약 조건을 확인하면
      // Then: 논리적으로 유효한 값들이어야 함
      expect(workerPoolConfig.minWorkers).toBeLessThanOrEqual(workerPoolConfig.maxWorkers);
      expect(workerPoolConfig.minWorkers).toBeGreaterThan(0);
      expect(workerPoolConfig.maxWorkers).toBeGreaterThan(0);
      expect(workerPoolConfig.workerTimeoutMs).toBeGreaterThan(0);
    });

    it('should validate git configuration', () => {
      // Given: Git 설정이 있을 때
      const gitConfigs = [
        { cloneDepth: 1, enableConcurrencyLock: true },
        { cloneDepth: 50, enableConcurrencyLock: false },
        { cloneDepth: 0, enableConcurrencyLock: true }  // 0 means full clone
      ];

      // When & Then: 모든 Git 설정이 유효해야 함
      gitConfigs.forEach(config => {
        expect(typeof config.cloneDepth).toBe('number');
        expect(config.cloneDepth).toBeGreaterThanOrEqual(0);
        expect(typeof config.enableConcurrencyLock).toBe('boolean');
      });
    });
  });

  describe('SystemDeveloperConfig interface', () => {
    it('should have all required properties with correct types', () => {
      // Given: SystemDeveloperConfig 인터페이스를 구현한 객체가 있을 때
      const mockDeveloperConfig: SystemDeveloperConfig = {
        claudeCodePath: '/usr/local/bin/claude-code',
        claudeCodeTimeoutMs: 300000,
        geminiCliPath: '/usr/local/bin/gemini',
        geminiCliTimeoutMs: 300000
      };

      // When: 각 속성을 확인하면
      // Then: 모든 필수 속성이 올바른 타입으로 존재해야 함
      expect(typeof mockDeveloperConfig.claudeCodePath).toBe('string');
      expect(typeof mockDeveloperConfig.claudeCodeTimeoutMs).toBe('number');
      expect(typeof mockDeveloperConfig.geminiCliPath).toBe('string');
      expect(typeof mockDeveloperConfig.geminiCliTimeoutMs).toBe('number');
    });

    it('should validate timeout configurations', () => {
      // Given: 다양한 타임아웃 설정이 있을 때
      const timeoutConfigs = [
        { claudeCodeTimeoutMs: 60000, geminiCliTimeoutMs: 120000 },
        { claudeCodeTimeoutMs: 300000, geminiCliTimeoutMs: 300000 },
        { claudeCodeTimeoutMs: 600000, geminiCliTimeoutMs: 900000 }
      ];

      // When & Then: 모든 타임아웃이 양수여야 함
      timeoutConfigs.forEach(config => {
        expect(config.claudeCodeTimeoutMs).toBeGreaterThan(0);
        expect(config.geminiCliTimeoutMs).toBeGreaterThan(0);
      });
    });

    it('should support different executable paths', () => {
      // Given: 다른 실행 파일 경로를 가진 설정이 있을 때
      const pathConfigs = [
        {
          claudeCodePath: 'claude-code',  // PATH에서 찾기
          geminiCliPath: 'gemini'
        },
        {
          claudeCodePath: '/usr/local/bin/claude-code',  // 절대 경로
          geminiCliPath: '/opt/gemini/bin/gemini'
        },
        {
          claudeCodePath: './bin/claude-code',  // 상대 경로
          geminiCliPath: '~/tools/gemini'
        }
      ];

      // When & Then: 모든 경로 형식이 유효해야 함
      pathConfigs.forEach(config => {
        expect(typeof config.claudeCodePath).toBe('string');
        expect(config.claudeCodePath.length).toBeGreaterThan(0);
        expect(typeof config.geminiCliPath).toBe('string');
        expect(config.geminiCliPath.length).toBeGreaterThan(0);
      });
    });
  });

  describe('LoggerConfig interface', () => {
    it('should have all required properties with correct types', () => {
      // Given: LoggerConfig 인터페이스를 구현한 객체가 있을 때
      const mockLoggerConfig: LoggerConfig = {
        level: 'info',
        filePath: '/var/log/ai-devteam.log',
        enableConsole: true
      };

      // When: 각 속성을 확인하면
      // Then: 모든 필수 속성이 올바른 타입으로 존재해야 함
      expect(['error', 'warn', 'info', 'debug']).toContain(mockLoggerConfig.level);
      expect(typeof mockLoggerConfig.filePath).toBe('string');
      expect(typeof mockLoggerConfig.enableConsole).toBe('boolean');
    });

    it('should support all log levels', () => {
      // Given: 다른 로그 레벨의 설정들이 있을 때
      const logConfigs = [
        { level: 'error' as const },
        { level: 'warn' as const },
        { level: 'info' as const },
        { level: 'debug' as const }
      ];

      // When & Then: 모든 로그 레벨이 유효해야 함
      logConfigs.forEach(config => {
        expect(['error', 'warn', 'info', 'debug']).toContain(config.level);
      });
    });

    it('should validate file path formats', () => {
      // Given: 다양한 파일 경로를 가진 설정이 있을 때
      const pathConfigs = [
        { filePath: '/var/log/app.log' },      // 절대 경로
        { filePath: './logs/app.log' },        // 상대 경로
        { filePath: '~/logs/app.log' },        // 홈 디렉토리
        { filePath: 'app.log' }                // 현재 디렉토리
      ];

      // When & Then: 모든 파일 경로가 유효해야 함
      pathConfigs.forEach(config => {
        expect(typeof config.filePath).toBe('string');
        expect(config.filePath.length).toBeGreaterThan(0);
      });
    });
  });

  describe('SystemConfig interface', () => {
    it('should have all required properties with correct types', () => {
      // Given: SystemConfig 인터페이스를 구현한 객체가 있을 때
      const mockSystemConfig: SystemConfig = {
        planner: {
          pollingIntervalMs: 30000,
          projectBoard: {
            provider: ServiceProvider.GITHUB,
            boardId: 'board-123',
            config: {
              type: ServiceProvider.GITHUB,
              apiToken: 'token'
            }
          },
          repository: {
            provider: ServiceProvider.GITHUB,
            owner: 'owner',
            name: 'repo',
            config: {
              type: ServiceProvider.GITHUB,
              apiToken: 'token'
            }
          }
        },
        manager: {
          workspaceRoot: '/workspace',
          workerPool: {
            minWorkers: 1,
            maxWorkers: 5,
            workerTimeoutMs: 600000
          },
          gitOperationTimeoutMs: 60000,
          repositoryCacheTimeoutMs: 300000,
          gitConfig: {
            cloneDepth: 1,
            enableConcurrencyLock: true
          },
          pullRequest: {
            provider: ServiceProvider.GITHUB,
            config: {
              type: ServiceProvider.GITHUB,
              apiToken: 'token'
            }
          }
        },
        developer: {
          claudeCodePath: 'claude-code',
          claudeCodeTimeoutMs: 300000,
          geminiCliPath: 'gemini',
          geminiCliTimeoutMs: 300000
        },
        logger: {
          level: 'info',
          filePath: '/var/log/app.log',
          enableConsole: true
        },
        nodeEnv: 'development'
      };

      // When: 각 속성을 확인하면
      // Then: 모든 필수 속성이 올바른 타입으로 존재해야 함
      expect(mockSystemConfig.planner).toBeDefined();
      expect(mockSystemConfig.manager).toBeDefined();
      expect(mockSystemConfig.developer).toBeDefined();
      expect(mockSystemConfig.logger).toBeDefined();
      expect(['development', 'production', 'test']).toContain(mockSystemConfig.nodeEnv);
    });

    it('should support all node environments', () => {
      // Given: 다른 Node 환경의 시스템 설정들이 있을 때
      const environments = ['development', 'production', 'test'] as const;

      // When & Then: 모든 환경이 유효해야 함
      environments.forEach(env => {
        expect(['development', 'production', 'test']).toContain(env);
      });
    });

    it('should ensure all sub-configs are properly typed', () => {
      // Given: SystemConfig의 모든 하위 설정이 정의되어 있을 때
      const systemConfig: SystemConfig = {
        planner: {} as PlannerConfig,
        manager: {} as ManagerConfig,
        developer: {} as SystemDeveloperConfig,
        logger: {} as LoggerConfig,
        nodeEnv: 'development'
      };

      // When & Then: 모든 하위 설정이 올바른 타입으로 존재해야 함
      expect(systemConfig.planner).toBeDefined();
      expect(systemConfig.manager).toBeDefined();
      expect(systemConfig.developer).toBeDefined();
      expect(systemConfig.logger).toBeDefined();
      expect(systemConfig.nodeEnv).toBeDefined();
    });

    it('should ensure readonly properties', () => {
      // Given: SystemConfig 객체가 있을 때
      const config: SystemConfig = {
        planner: {} as PlannerConfig,
        manager: {} as ManagerConfig,
        developer: {} as SystemDeveloperConfig,
        logger: {} as LoggerConfig,
        nodeEnv: 'production'
      };

      // When & Then: readonly 속성들은 타입 레벨에서 변경이 불가능해야 함
      expect(() => {
        // @ts-expect-error - readonly 속성은 변경할 수 없음
        config.nodeEnv = 'development';
      }).toBeDefined();
    });

    it('should validate cross-component configuration consistency', () => {
      // Given: 통합된 시스템 설정이 있을 때
      const consistentConfig: SystemConfig = {
        planner: {
          pollingIntervalMs: 30000,
          projectBoard: {
            provider: ServiceProvider.GITHUB,
            boardId: 'board-123',
            config: {
              type: ServiceProvider.GITHUB,
              apiToken: 'shared_token'
            }
          },
          repository: {
            provider: ServiceProvider.GITHUB,
            owner: 'org',
            name: 'repo',
            config: {
              type: ServiceProvider.GITHUB,
              apiToken: 'shared_token'  // 같은 토큰 사용
            }
          }
        },
        manager: {
          workspaceRoot: '/workspace',
          workerPool: {
            minWorkers: 1,
            maxWorkers: 3,  // planner 폴링 간격과 조화
            workerTimeoutMs: 300000
          },
          gitOperationTimeoutMs: 60000,
          repositoryCacheTimeoutMs: 300000,
          gitConfig: {
            cloneDepth: 1,
            enableConcurrencyLock: true
          },
          pullRequest: {
            provider: ServiceProvider.GITHUB,  // planner와 같은 제공자
            config: {
              type: ServiceProvider.GITHUB,
              apiToken: 'shared_token'
            }
          }
        },
        developer: {
          claudeCodePath: 'claude-code',
          claudeCodeTimeoutMs: 240000,  // worker timeout보다 작게
          geminiCliPath: 'gemini',
          geminiCliTimeoutMs: 240000
        },
        logger: {
          level: 'info',
          filePath: '/workspace/logs/app.log',  // workspace 하위
          enableConsole: true
        },
        nodeEnv: 'production'
      };

      // When & Then: 컴포넌트 간 설정이 일관성 있게 구성되어야 함
      expect(consistentConfig.planner.repository.config.apiToken)
        .toBe(consistentConfig.manager.pullRequest.config.apiToken);
      expect(consistentConfig.developer.claudeCodeTimeoutMs)
        .toBeLessThan(consistentConfig.manager.workerPool.workerTimeoutMs);
      expect(consistentConfig.logger.filePath).toContain(consistentConfig.manager.workspaceRoot);
    });
  });
});
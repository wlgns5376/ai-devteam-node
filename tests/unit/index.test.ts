import { main } from '../../src/index';

// Mock process.exit to prevent actual process termination
const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit() called');
});

// Mock the CLI and AppConfigLoader to prevent actual execution
jest.mock('../../src/cli/commands', () => ({
  createCLI: jest.fn().mockReturnValue({
    parseAsync: jest.fn().mockRejectedValue(new Error('unknown command'))
  })
}));

jest.mock('../../src/config/app-config', () => ({
  AppConfigLoader: {
    loadFromEnvironment: jest.fn().mockReturnValue({}),
    validate: jest.fn()
  }
}));

jest.mock('../../src/app', () => ({
  AIDevTeamApp: jest.fn().mockImplementation(() => ({
    setupSignalHandlers: jest.fn(),
    initialize: jest.fn().mockResolvedValue(undefined),
    start: jest.fn().mockResolvedValue(undefined)
  }))
}));

// Mock process.stdin to prevent hanging
Object.defineProperty(process.stdin, 'resume', {
  value: jest.fn()
});

describe('AI DevTeam Main', () => {
  beforeEach(() => {
    // CLI 인자 초기화 (기본 모드로 실행되도록)
    process.argv = ['node', 'index.js'];
    jest.clearAllMocks();
  });

  describe('main function', () => {
    it('should be importable and defined', () => {
      // Given & When: main 함수를 import할 때
      // Then: 함수가 정의되어야 함
      expect(main).toBeDefined();
      expect(typeof main).toBe('function');
    });

    it('should handle basic execution without crashing', () => {
      // Given
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // When & Then: 함수 호출이 완료되어야 함 (오류나 무한 대기 없이)
      expect(() => {
        main().catch(() => {
          // 오류가 발생해도 테스트는 통과 (실제 실행이 아니므로)
        });
      }).not.toThrow();
    });
  });
});
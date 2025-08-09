import { config } from 'dotenv';
import { createCLI } from './cli/commands';
import { AIDevTeamApp } from './app';
import { AppConfigLoader } from './config/app-config';

// Load environment variables (quiet to suppress logs)
config({ quiet: true });

/**
 * AI DevTeam main entry point
 */
export async function main(): Promise<void> {
  try {
    // CLI 모드인지 확인
    if (process.argv.length > 2) {
      // CLI 명령어 처리
      const program = createCLI();
      await program.parseAsync();
      return;
    }

    // 기본 실행 모드 (CLI 인자 없이 실행된 경우)
    console.log('🚀 AI DevTeam 시스템을 기본 모드로 시작합니다...');
    console.log('💡 CLI 사용법: npm run dev -- <command>');
    console.log('   예시: npm run dev -- start');
    console.log('   예시: npm run dev -- status');
    console.log('   예시: npm run dev -- config --validate');

    // 기본 설정으로 애플리케이션 시작
    const config = AppConfigLoader.loadFromEnvironment();
    AppConfigLoader.validate(config);

    const app = new AIDevTeamApp(config);
    app.setupSignalHandlers();

    await app.initialize();
    await app.start();

    console.log('💡 Ctrl+C를 눌러 시스템을 종료하세요.');
    
    // 사용자 입력 대기
    process.stdin.resume();

  } catch (error) {
    console.error('❌ AI DevTeam 시스템 실행 실패:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Export classes for programmatic usage
export { AIDevTeamApp } from './app';
export { AppConfigLoader } from './config/app-config';
export type { AppConfig } from './config/app-config';

// Run the application if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
  });
}
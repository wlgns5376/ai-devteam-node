import { Command } from 'commander';
import { AIDevTeamApp, SystemStatus } from '../app';
import { AppConfigLoader } from '../config/app-config';

export function createCLI(): Command {
  const program = new Command();

  program
    .name('ai-devteam')
    .description('AI DevTeam automation system using Claude Code and Gemini CLI')
    .version('1.0.0');

  // start 명령어
  program
    .command('start')
    .description('AI DevTeam 시스템 시작')
    .option('-c, --config <path>', '설정 파일 경로', './src/config/default.json')
    .option('-d, --daemon', '백그라운드에서 실행')
    .action(async (options) => {
      try {
        const config = AppConfigLoader.loadFromFile(options.config);
        AppConfigLoader.validate(config);

        const app = new AIDevTeamApp(config);
        
        // Signal 핸들러 설정
        app.setupSignalHandlers();

        await app.initialize();
        await app.start();

        if (options.daemon) {
          console.log('🔄 백그라운드 모드로 실행 중...');
          // 무한 대기
          await new Promise(() => {});
        } else {
          console.log('💡 Ctrl+C를 눌러 시스템을 종료하세요.');
          // 사용자 입력 대기
          process.stdin.resume();
        }

      } catch (error) {
        console.error('❌ 시작 실패:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // status 명령어
  program
    .command('status')
    .description('시스템 상태 확인')
    .option('-c, --config <path>', '설정 파일 경로', './src/config/default.json')
    .action(async (options) => {
      try {
        const config = AppConfigLoader.loadFromFile(options.config);
        const app = new AIDevTeamApp(config);
        
        // 상태만 확인하기 위해 초기화만 수행
        await app.initialize();
        const status = app.getStatus();

        console.log('📊 AI DevTeam 시스템 상태:');
        console.log('─'.repeat(50));
        console.log(`🔄 실행 상태: ${status.isRunning ? '✅ 실행 중' : '❌ 정지됨'}`);
        
        if (status.startedAt) {
          console.log(`⏰ 시작 시간: ${status.startedAt.toLocaleString()}`);
        }
        
        if (status.uptime) {
          const uptimeSeconds = Math.floor(status.uptime / 1000);
          const hours = Math.floor(uptimeSeconds / 3600);
          const minutes = Math.floor((uptimeSeconds % 3600) / 60);
          const seconds = uptimeSeconds % 60;
          console.log(`⏱️  업타임: ${hours}h ${minutes}m ${seconds}s`);
        }

        if (status.plannerStatus) {
          console.log(`📋 Planner: ${status.plannerStatus.isRunning ? '실행 중' : '정지됨'}`);
          console.log(`📈 처리된 작업: ${status.plannerStatus.totalTasksProcessed}개`);
          console.log(`🔄 활성 작업: ${status.plannerStatus.activeTasks}개`);
        }

        if (status.workerPoolStatus) {
          console.log(`👷 Worker Pool: ${status.workerPoolStatus.activeWorkers}/${status.workerPoolStatus.workers.length} (활성/전체)`);
        }

      } catch (error) {
        console.error('❌ 상태 확인 실패:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // config 명령어
  program
    .command('config')
    .description('설정 확인')
    .option('-c, --config <path>', '설정 파일 경로', './src/config/default.json')
    .option('--validate', '설정 유효성 검사만 수행')
    .action(async (options) => {
      try {
        const config = AppConfigLoader.loadFromFile(options.config);
        
        if (options.validate) {
          AppConfigLoader.validate(config);
          console.log('✅ 설정 파일이 유효합니다.');
          return;
        }

        console.log('⚙️  AI DevTeam 설정:');
        console.log('─'.repeat(50));
        console.log(JSON.stringify(config, null, 2));

      } catch (error) {
        console.error('❌ 설정 확인 실패:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // sync 명령어
  program
    .command('sync')
    .description('강제 동기화 실행')
    .option('-c, --config <path>', '설정 파일 경로', './src/config/default.json')
    .action(async (options) => {
      try {
        const config = AppConfigLoader.loadFromFile(options.config);
        const app = new AIDevTeamApp(config);
        
        await app.initialize();
        await app.forceSync();

      } catch (error) {
        console.error('❌ 동기화 실패:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // logs 명령어
  program
    .command('logs')
    .description('로그 조회')
    .option('-f, --follow', '실시간 로그 조회')
    .option('-n, --lines <number>', '표시할 라인 수', '50')
    .option('--log-file <path>', '로그 파일 경로', './logs/app.log')
    .action(async (options) => {
      try {
        const fs = require('fs');
        const path = require('path');

        if (!fs.existsSync(options.logFile)) {
          console.log('📄 로그 파일이 존재하지 않습니다:', options.logFile);
          return;
        }

        if (options.follow) {
          console.log('📄 실시간 로그 조회 중... (Ctrl+C로 종료)');
          const { spawn } = require('child_process');
          const tail = spawn('tail', ['-f', options.logFile], { stdio: 'inherit' });
          
          process.on('SIGINT', () => {
            tail.kill();
            process.exit(0);
          });
        } else {
          const { spawn } = require('child_process');
          const tail = spawn('tail', ['-n', options.lines, options.logFile], { stdio: 'inherit' });
        }

      } catch (error) {
        console.error('❌ 로그 조회 실패:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return program;
}
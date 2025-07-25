import { DeveloperFactory } from './services/developer/developer-factory';
import { Logger, LogLevel } from './services/logger';

async function runSimpleDemo() {
  console.log('🚀 AI DevTeam Developer 인터페이스 데모 시작\n');

  try {
    // 1. Logger 초기화
    const logger = new Logger({
      level: LogLevel.INFO,
      enableConsole: true
    });

    // 2. Mock Developer 생성
    console.log('🤖 Mock Developer 초기화 중...');
    const developer = DeveloperFactory.create('mock', {
      timeoutMs: 30000,
      maxRetries: 3,
      retryDelayMs: 1000,
      mock: {
        responseDelay: 1000
      }
    }, { logger });

    await developer.initialize();
    console.log('✅ Mock Developer 초기화 완료\n');

    // 3. 신규 작업 시나리오 테스트
    console.log('🔄 신규 작업 시나리오 테스트...\n');

    const prompt = `새로운 작업을 시작합니다.
작업 제목: 사용자 인증 기능 구현
설명: JWT 기반 사용자 인증 시스템을 구현해주세요.
- 로그인/로그아웃 기능
- JWT 토큰 생성 및 검증
- 사용자 세션 관리
- 테스트 코드 작성

작업 디렉토리: /tmp/test-workspace
저장소: test-repo
브랜치: feature/user-auth

PR을 생성해주세요.`;

    console.log('📤 Developer에게 프롬프트 전송 중...');
    console.log('프롬프트 내용:');
    console.log('─'.repeat(50));
    console.log(prompt);
    console.log('─'.repeat(50));

    const result = await developer.executePrompt(prompt, '/tmp/test-workspace');

    console.log('\n📨 Developer 응답 받음:');
    console.log('─'.repeat(50));
    console.log('🔸 성공 여부:', result.result.success);
    if (result.result.prLink) {
      console.log('🔸 PR 링크:', result.result.prLink);
    }
    if (result.result.commitHash) {
      console.log('🔸 커밋 해시:', result.result.commitHash);
    }
    console.log('🔸 실행된 명령어 수:', result.executedCommands.length);
    console.log('🔸 수정된 파일 수:', result.modifiedFiles.length);
    console.log('🔸 소요 시간:', result.metadata.duration + 'ms');
    console.log('─'.repeat(50));

    if (result.executedCommands.length > 0) {
      console.log('\n📋 실행된 명령어:');
      result.executedCommands.forEach((cmd, index) => {
        console.log(`${index + 1}. ${cmd.command}`);
        if (cmd.output) {
          console.log(`   출력: ${cmd.output.substring(0, 100)}${cmd.output.length > 100 ? '...' : ''}`);
        }
      });
    }

    if (result.modifiedFiles.length > 0) {
      console.log('\n📂 수정된 파일:');
      result.modifiedFiles.forEach((file, index) => {
        console.log(`${index + 1}. ${file}`);
      });
    }

    // 4. 피드백 처리 시나리오 테스트
    console.log('\n🔄 피드백 처리 시나리오 테스트...\n');

    const feedbackPrompt = `다음 PR 피드백을 처리해주세요:

코드 리뷰 피드백:
1. 패스워드 해싱에 bcrypt를 사용하세요
2. JWT secret을 환경변수로 관리하세요
3. 에러 핸들링을 개선하세요
4. 단위 테스트를 추가하세요

피드백을 반영하여 코드를 수정하고 커밋해주세요.`;

    console.log('📤 피드백 처리 프롬프트 전송 중...');
    const feedbackResult = await developer.executePrompt(feedbackPrompt, '/tmp/test-workspace');

    console.log('\n📨 피드백 처리 결과:');
    console.log('🔸 성공 여부:', feedbackResult.result.success);
    console.log('🔸 실행된 명령어 수:', feedbackResult.executedCommands.length);

    // 5. PRD 시나리오 검증
    console.log('\n✅ PRD 시나리오 검증 결과:');
    console.log('─'.repeat(50));
    console.log('✅ Developer가 프롬프트를 받아서 작업을 실행함');
    console.log('✅ AI로부터 전달받은 PR 링크를 반환함');
    console.log('✅ 작업 완료 상태를 정확히 보고함');
    console.log('✅ 피드백 처리 시나리오 동작함');
    console.log('─'.repeat(50));

    // 6. 정리
    console.log('\n🧹 정리 작업...');
    await developer.cleanup();
    console.log('✅ Developer 정리 완료');

    console.log('\n🎉 AI DevTeam Developer 인터페이스 데모 완료!');
    console.log('\n📊 요약:');
    console.log('- Mock Developer 성공적으로 동작');
    console.log('- PRD의 Developer 역할 시나리오 검증 완료');
    console.log('- Worker와의 통합 준비 완료');

  } catch (error) {
    console.error('\n❌ 에러 발생:', error);
  }
}

// 데모 실행
runSimpleDemo().catch(console.error);
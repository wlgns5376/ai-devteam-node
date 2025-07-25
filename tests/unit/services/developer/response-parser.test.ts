import { ResponseParser } from '@/services/developer/response-parser';
import { Command } from '@/types/developer.types';

describe('ResponseParser', () => {
  let parser: ResponseParser;

  beforeEach(() => {
    parser = new ResponseParser();
  });

  describe('PR 링크 추출', () => {
    it('GitHub PR 링크를 추출해야 한다', () => {
      // Given: PR 링크가 포함된 텍스트
      const output = `
        작업을 완료했습니다.
        PR을 생성했습니다: https://github.com/user/repo/pull/123
        리뷰를 요청해주세요.
      `;

      // When: PR 링크 추출
      const prLink = parser.extractPrLink(output);

      // Then: 올바른 링크 추출
      expect(prLink).toBe('https://github.com/user/repo/pull/123');
    });

    it('여러 PR 링크 중 첫 번째를 추출해야 한다', () => {
      // Given: 여러 PR 링크
      const output = `
        첫 번째 PR: https://github.com/user/repo/pull/123
        두 번째 PR: https://github.com/user/repo/pull/456
      `;

      // When: PR 링크 추출
      const prLink = parser.extractPrLink(output);

      // Then: 첫 번째 링크 추출
      expect(prLink).toBe('https://github.com/user/repo/pull/123');
    });

    it('PR 링크가 없으면 undefined를 반환해야 한다', () => {
      // Given: PR 링크가 없는 텍스트
      const output = '코드를 수정했습니다.';

      // When: PR 링크 추출
      const prLink = parser.extractPrLink(output);

      // Then: undefined 반환
      expect(prLink).toBeUndefined();
    });
  });

  describe('커밋 해시 추출', () => {
    it('40자리 커밋 해시를 추출해야 한다', () => {
      // Given: 커밋 해시가 포함된 텍스트
      const output = `
        커밋을 생성했습니다.
        [main 1234567890abcdef1234567890abcdef12345678] Add user authentication
      `;

      // When: 커밋 해시 추출
      const commitHash = parser.extractCommitHash(output);

      // Then: 올바른 해시 추출
      expect(commitHash).toBe('1234567890abcdef1234567890abcdef12345678');
    });

    it('짧은 커밋 해시는 무시해야 한다', () => {
      // Given: 짧은 해시와 전체 해시
      const output = `
        짧은 해시: 1234567
        전체 해시: 1234567890abcdef1234567890abcdef12345678
      `;

      // When: 커밋 해시 추출
      const commitHash = parser.extractCommitHash(output);

      // Then: 전체 해시만 추출
      expect(commitHash).toBe('1234567890abcdef1234567890abcdef12345678');
    });

    it('커밋 해시가 없으면 undefined를 반환해야 한다', () => {
      // Given: 해시가 없는 텍스트
      const output = '작업을 완료했습니다.';

      // When: 커밋 해시 추출
      const commitHash = parser.extractCommitHash(output);

      // Then: undefined 반환
      expect(commitHash).toBeUndefined();
    });
  });

  describe('명령어 추출', () => {
    it('실행된 명령어를 추출해야 한다', () => {
      // Given: 명령어 실행 로그
      const output = `
$ git checkout -b feature/auth
Switched to a new branch 'feature/auth'

$ npm test
All tests passed

$ git add .
$ git commit -m "Add authentication"
[feature/auth 1234567] Add authentication
 2 files changed, 100 insertions(+)
      `;

      // When: 명령어 추출
      const commands = parser.extractCommands(output);

      // Then: 모든 명령어 추출
      expect(commands).toHaveLength(4);
      expect(commands[0]?.command).toBe('git checkout -b feature/auth');
      expect(commands[0]?.output).toContain("Switched to a new branch 'feature/auth'");
      expect(commands[0]?.exitCode).toBe(0);
      
      expect(commands[1]?.command).toBe('npm test');
      expect(commands[1]?.output).toContain('All tests passed');
      
      expect(commands[2]?.command).toBe('git add .');
      expect(commands[3]?.command).toBe('git commit -m "Add authentication"');
    });

    it('실패한 명령어의 exit code를 설정해야 한다', () => {
      // Given: 실패한 명령어
      const output = `
$ npm test
Error: Test failed
npm ERR! Test failed
npm ERR! Exit status 1
      `;

      // When: 명령어 추출
      const commands = parser.extractCommands(output);

      // Then: 실패 상태 확인
      expect(commands).toHaveLength(1);
      expect(commands[0]?.command).toBe('npm test');
      expect(commands[0]?.exitCode).toBe(1);
    });

    it('명령어가 없으면 빈 배열을 반환해야 한다', () => {
      // Given: 명령어가 없는 텍스트
      const output = '분석을 완료했습니다.';

      // When: 명령어 추출
      const commands = parser.extractCommands(output);

      // Then: 빈 배열 반환
      expect(commands).toEqual([]);
    });
  });

  describe('수정된 파일 추출', () => {
    it('수정된 파일 목록을 추출해야 한다', () => {
      // Given: git status 출력
      const output = `
$ git status
On branch feature/auth
Changes to be committed:
  new file:   src/auth/auth.service.ts
  new file:   src/auth/auth.controller.ts
  modified:   src/app.module.ts
      `;

      // When: 파일 목록 추출
      const files = parser.extractModifiedFiles(output);

      // Then: 모든 파일 추출
      expect(files).toEqual([
        'src/auth/auth.service.ts',
        'src/auth/auth.controller.ts',
        'src/app.module.ts'
      ]);
    });

    it('git diff 출력에서 파일을 추출해야 한다', () => {
      // Given: git diff 출력
      const output = `
$ git diff --name-only
src/users/user.entity.ts
src/users/user.service.ts
tests/users.test.ts
      `;

      // When: 파일 목록 추출
      const files = parser.extractModifiedFiles(output);

      // Then: 모든 파일 추출
      expect(files).toContain('src/users/user.entity.ts');
      expect(files).toContain('src/users/user.service.ts');
      expect(files).toContain('tests/users.test.ts');
    });

    it('중복된 파일은 한 번만 포함해야 한다', () => {
      // Given: 중복된 파일 언급
      const output = `
Modified src/app.module.ts
Updated src/app.module.ts again
Changed src/auth/auth.service.ts
      `;

      // When: 파일 목록 추출
      const files = parser.extractModifiedFiles(output);

      // Then: 중복 제거 확인
      expect(files).toHaveLength(2);
      expect(files).toContain('src/app.module.ts');
      expect(files).toContain('src/auth/auth.service.ts');
    });

    it('파일이 없으면 빈 배열을 반환해야 한다', () => {
      // Given: 파일 언급이 없는 텍스트
      const output = '코드 분석을 완료했습니다.';

      // When: 파일 목록 추출
      const files = parser.extractModifiedFiles(output);

      // Then: 빈 배열 반환
      expect(files).toEqual([]);
    });
  });

  describe('성공 여부 판단', () => {
    it('성공 키워드가 있으면 true를 반환해야 한다', () => {
      // Given: 성공을 나타내는 출력
      const outputs = [
        'Successfully created PR',
        'All tests passed',
        'Build succeeded',
        '작업을 완료했습니다'
      ];

      // When & Then: 각 출력 확인
      outputs.forEach(output => {
        expect(parser.isSuccess(output)).toBe(true);
      });
    });

    it('실패 키워드가 있으면 false를 반환해야 한다', () => {
      // Given: 실패를 나타내는 출력
      const outputs = [
        'Error: Command failed',
        'Test failed',
        'Build failed',
        'npm ERR!'
      ];

      // When & Then: 각 출력 확인
      outputs.forEach(output => {
        expect(parser.isSuccess(output)).toBe(false);
      });
    });
  });

  describe('전체 출력 파싱', () => {
    it('복잡한 출력을 종합적으로 파싱해야 한다', () => {
      // Given: 실제와 유사한 출력
      const output = `
작업을 시작합니다...

$ git checkout -b feature/user-auth
Switched to a new branch 'feature/user-auth'

$ npm test
All tests passed

인증 서비스를 구현했습니다.
  new file:   src/auth/auth.service.ts
  new file:   src/auth/auth.controller.ts
  modified:   src/app.module.ts

$ git add .
$ git commit -m "Add user authentication feature"
[feature/user-auth abc1234567890def1234567890abcdef12345678] Add user authentication feature
 3 files changed, 150 insertions(+)

$ gh pr create --title "Add user authentication" --body "Implements JWT-based authentication"
https://github.com/user/repo/pull/42

작업을 완료했습니다!
      `;

      // When: 전체 파싱
      const result = parser.parseOutput(output);

      // Then: 모든 정보가 올바르게 추출
      expect(result.success).toBe(true);
      expect(result.prLink).toBe('https://github.com/user/repo/pull/42');
      expect(result.commitHash).toBe('abc1234567890def1234567890abcdef12345678');
      expect(result.commands).toHaveLength(4);
      expect(result.modifiedFiles).toEqual([
        'src/auth/auth.service.ts',
        'src/auth/auth.controller.ts',
        'src/app.module.ts'
      ]);
    });
  });
});
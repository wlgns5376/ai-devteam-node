# AI DevTeam

Claude Code와 Gemini CLI 같은 터미널 기반 서비스를 이용한 프로그램 개발 자동화 시스템

## 개요

AI DevTeam은 GitHub Projects와 연동하여 자동으로 개발 작업을 수행하는 시스템입니다. AI 개발자(Claude Code, Gemini CLI)를 활용하여 코드 작성, 리뷰, 병합 등의 개발 과정을 자동화합니다.

## 주요 기능

- **프로젝트 보드 연동**: GitHub Projects (향후 Jira, Notion 확장 예정)
- **소스 코드 관리**: Git, GitHub API, GitHub CLI 연동
- **AI 개발자 지원**: Claude Code, Gemini CLI 통합
- **상태 관리**: JSON 기반 메타데이터 및 상태 저장 (향후 DB 확장 예정)
- **작업 자동화**: 신규 작업, 진행 중 작업, 리뷰 처리 자동화

## 시스템 아키텍처

### 주요 컴포넌트

- **Planner**: 프로젝트 보드 작업 조회 및 상태 관리
- **Manager**: 워커 풀 관리 및 작업 할당
- **Worker**: 개별 작업 수행 및 워크트리 관리
- **Developer**: AI 개발자 인터페이스 (Claude Code, Gemini CLI)
- **Logger**: 시스템 로깅

### 작업 흐름

```
Planner → Manager → Worker → Developer → Worker → Manager → Planner
```

## 프로젝트 구조

```
ai-devteam-node/
├── src/
│   ├── components/          # 주요 컴포넌트
│   │   ├── planner/        # Planner 관련 코드
│   │   ├── manager/        # Manager 관련 코드
│   │   ├── worker/         # Worker 관련 코드
│   │   └── developer/      # Developer 인터페이스
│   ├── services/           # 외부 연동 서비스
│   │   ├── github/         # GitHub API 연동
│   │   └── git/            # Git 작업 관리
│   ├── types/              # TypeScript 타입 정의
│   ├── utils/              # 유틸리티 함수
│   └── index.ts            # 메인 엔트리 포인트
├── tests/                  # 테스트 파일
│   ├── unit/              # 단위 테스트
│   ├── integration/       # 통합 테스트
│   ├── fixtures/          # 테스트용 데이터
│   └── setup.ts           # 테스트 설정
├── docs/                   # 문서
├── logs/                   # 로그 파일
├── workspaces/            # 작업 디렉토리 (gitignore)
└── .taskmaster/           # Task Master 설정
```

## 설치 및 실행

### 요구사항

- Node.js 20.0.0 이상
- Git
- GitHub CLI (선택사항)
- Claude Code CLI
- Gemini CLI

### 설치

```bash
# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env
# .env 파일을 편집하여 필요한 값을 설정하세요
```

### 환경 변수 설정

`.env` 파일에서 다음 값들을 설정해야 합니다:

```bash
# 필수 설정
GITHUB_TOKEN=your_github_personal_access_token_here
GITHUB_OWNER=your_github_username_or_organization
GITHUB_REPO=your_repository_name
GITHUB_PROJECT_ID=your_github_project_id

# 선택 설정 (기본값 사용 가능)
CLAUDE_CODE_PATH=claude-code
GEMINI_CLI_PATH=gemini
MIN_WORKERS=1
MAX_WORKERS=5
WORKSPACE_ROOT=./workspaces
```

### 실행

```bash
# 개발 모드
npm run dev

# 프로덕션 빌드 및 실행
npm run build
npm start

# 테스트 실행
npm test

# 테스트 (감시 모드)
npm run test:watch

# 커버리지 확인
npm run test:coverage
```

## 개발 가이드

### 코드 스타일

- **언어**: TypeScript (strict mode)
- **코드 스타일**: ESLint + Prettier
- **테스트**: Jest (커버리지 80% 이상)
- **아키텍처**: SOLID 원칙 준수

### 개발 프로세스

1. **TDD 방식**: 테스트 작성 → 구현 → 리팩토링
2. **Given-When-Then 패턴**: 테스트 케이스 작성
3. **Clean Architecture**: 계층별 역할 분리
4. **의존성 주입**: 테스트 가능한 코드 작성

### 스크립트

```bash
npm run build        # TypeScript 컴파일
npm run start        # 애플리케이션 실행
npm run dev          # 개발 모드 실행
npm run test         # 테스트 실행
npm run test:watch   # 테스트 감시 모드
npm run test:coverage # 커버리지 리포트
npm run lint         # ESLint 실행
npm run lint:fix     # ESLint 자동 수정
npm run format       # Prettier 실행
```

## 시나리오

### 1. 신규 작업
1. Planner가 GitHub Projects에서 새 작업을 감지
2. Manager가 사용 가능한 Worker에게 작업 할당
3. Worker가 저장소를 클론하고 워크트리 생성
4. Developer(AI)가 작업 수행 후 PR 생성
5. Planner가 작업 상태를 "리뷰 중"으로 변경

### 2. 진행 중 작업
1. Planner가 진행 중인 작업 상태 확인
2. Manager가 해당 Worker의 상태 점검
3. 필요시 작업 재개 또는 상태 업데이트

### 3. 리뷰 완료
1. Planner가 PR 승인 상태 확인
2. 승인 시: Manager가 Worker에게 병합 지시
3. 피드백 시: Worker가 Developer에게 수정 사항 전달

## 라이선스

ISC

## 기여하기

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for your changes
5. Ensure tests pass and coverage is maintained
6. Submit a pull request

## 지원

- GitHub Issues: 버그 리포트 및 기능 요청
- Documentation: `/docs` 디렉토리 참조
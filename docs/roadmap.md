# AI DevTeam 개발 로드맵

## 프로젝트 개요
AI DevTeam은 Claude Code, Gemini CLI 같은 터미널 기반 AI 서비스를 활용하여 소프트웨어 개발을 자동화하는 시스템입니다.

## 현재 개발 상태 (완료됨)

### ✅ 기반 시스템
- **프로젝트 구조 설계**: TypeScript 기반 모듈형 아키텍처 구성
- **타입 정의**: 모든 컴포넌트의 인터페이스 및 타입 정의 완료
- **테스트 환경**: Jest 기반 단위 테스트 및 통합 테스트 환경 구축

### ✅ 핵심 컴포넌트
1. **Planner 컴포넌트**
   - GitHub Projects API 연동 (Mock 구현 포함)
   - 작업 상태 모니터링 및 전환 로직
   - Manager와의 통신 인터페이스
   - 테스트 커버리지 100%

2. **Logger 시스템**
   - 레벨별 로깅 (debug, info, warn, error)
   - 컨텍스트 정보 포함
   - 콘솔 출력 구현

3. **상태 관리 시스템**
   - StateManager 구현
   - 작업 및 워커 상태 영속성

### ✅ 지원 서비스
- Mock Project Board 서비스
- Mock Pull Request 서비스
- Service Factory 패턴 구현

## 개발 예정 항목

### 🔄 Phase 1: Manager 컴포넌트 (우선순위: 높음)
- **Workspace 관리**
  - 작업별 디렉토리 생성/관리
  - Git 저장소 clone 및 fetch 기능
  - Git worktree 관리
  
- **Worker Pool 관리**
  - Worker 생성/삭제
  - Worker 상태 추적 (idle, waiting, working, stopped)
  - Worker 할당 알고리즘
  - 최소/최대 Worker 수 정책 적용

- **Planner-Worker 중개**
  - 작업 요청 라우팅
  - 작업 결과 수집 및 전달

### 🔄 Phase 2: Worker 컴포넌트 (우선순위: 높음)
- **작업 환경 설정**
  - 작업별 독립 디렉토리 생성
  - Git worktree 생성 (브랜치명: 작업ID)
  - CLAUDE.local.md 파일 관리

- **Developer 통신**
  - 프롬프트 생성 및 전달
  - AI 응답 처리
  - PR 링크 추출

- **상태 보고**
  - Manager에게 진행 상황 보고
  - 에러 처리 및 복구

### 🔄 Phase 3: Developer 인터페이스 (우선순위: 중간)
- **AI 서비스 통합**
  - Claude Code API 통합
  - Gemini CLI 통합
  - 프롬프트 템플릿 시스템

- **명령 실행**
  - 프롬프트 기반 작업 실행
  - PR 생성 및 링크 반환
  - 에러 핸들링

### 🔄 Phase 4: 워크플로우 통합 (우선순위: 중간)
- **신규 작업 처리**
  - 전체 플로우 통합 테스트
  - 엔드투엔드 시나리오 검증

- **진행중 작업 재개**
  - 중단된 작업 감지
  - 재개 프롬프트 생성
  - 상태 복구

- **리뷰 및 피드백 처리**
  - PR 코멘트 수집
  - 피드백 기반 수정 작업
  - 병합 프로세스

### 🔄 Phase 5: 프로덕션 준비 (우선순위: 낮음)
- **실제 서비스 통합**
  - GitHub API 실제 구현
  - GitHub Projects 실제 연동
  - GitHub CLI 통합

- **확장성 개선**
  - Jira, Notion 등 다른 프로젝트 보드 지원
  - 다양한 AI 개발자 도구 지원
  - 데이터베이스 기반 상태 저장

- **운영 기능**
  - 모니터링 대시보드
  - 성능 메트릭 수집
  - 에러 추적 및 알림

## 기술적 고려사항

### 동시성 처리
- Git 작업 동기화 메커니즘
- Worker Pool 동시 접근 제어
- 작업 큐 관리

### 에러 처리
- Worker 중단 시 복구 전략
- 타임아웃 처리
- 재시도 로직

### 테스트 전략
- 모든 컴포넌트 단위 테스트 (목표: 80% 이상 커버리지)
- 통합 테스트 시나리오
- E2E 테스트 자동화

## 마일스톤

### M1: Core System (2-3주)
- Manager 컴포넌트 완성
- Worker 컴포넌트 완성
- 기본 워크플로우 동작

### M2: AI Integration (1-2주)
- Developer 인터페이스 구현
- AI 서비스 통합
- 프롬프트 시스템

### M3: Production Ready (2-3주)
- 실제 GitHub 서비스 연동
- 성능 최적화
- 운영 도구 구축

### M4: Extension (진행중)
- 다양한 프로젝트 보드 지원
- 추가 AI 도구 통합
- 엔터프라이즈 기능

## 다음 단계
1. Manager 컴포넌트의 Worker Pool 관리 기능 구현
2. Worker 컴포넌트의 기본 구조 설계 및 구현
3. Manager-Worker 간 통신 프로토콜 정의
4. Git 작업 동기화 메커니즘 구현
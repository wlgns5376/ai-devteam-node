# AI DevTeam 개발 로드맵

## 프로젝트 개요
AI DevTeam은 Claude Code, Gemini CLI 같은 터미널 기반 AI 서비스를 활용하여 소프트웨어 개발을 자동화하는 시스템입니다.

## 현재 개발 상태 (2025-01-25 기준)

### ✅ 완료된 컴포넌트 (Task Master 기준)
1. **프로젝트 기반 설정** (Task #1)
   - TypeScript 기반 모듈형 아키텍처 구성
   - Jest 기반 테스트 환경 구축
   - pnpm 패키지 매니저 설정

2. **타입 시스템** (Task #2)
   - 모든 컴포넌트의 인터페이스 및 타입 정의 완료
   - SOLID 원칙 준수한 인터페이스 설계
   - 확장 가능한 타입 구조

3. **Logger 시스템** (Task #12)
   - 레벨별 로깅 (debug, info, warn, error)
   - 컨텍스트 정보 포함
   - 콘솔 출력 구현
   - 100% 테스트 커버리지

4. **상태 관리 시스템** (Task #5)
   - StateManager 구현
   - 작업 및 워커 상태 JSON 영속성
   - 파일 기반 상태 저장

### ✅ 구현 완료되었으나 Task Master에 미반영된 컴포넌트
1. **Planner 컴포넌트** (Task #6 - pending으로 표시되어 있으나 실제 구현됨)
   - GitHub Projects API 연동 (Mock 구현 포함)
   - 작업 상태 모니터링 및 전환 로직
   - Manager와의 통신 인터페이스
   - 100% 테스트 커버리지

2. **Manager 컴포넌트** (Task #10 - pending으로 표시되어 있으나 실제 구현됨)
   - WorkerPoolManager 구현 완료
   - Worker 생성/삭제/상태 관리
   - Worker 할당 알고리즘
   - 최소/최대 Worker 수 정책 적용
   - WorkspaceManager 구현 (파일 존재 확인)

3. **Worker 컴포넌트** (Task #8 - pending으로 표시되어 있으나 실제 구현됨)
   - Worker 클래스 구현 완료
   - 작업 실행 워크플로우
   - 상태 관리 (IDLE, WAITING, WORKING, STOPPED)
   - WorkspaceSetup - 작업 환경 설정
   - PromptGenerator - 프롬프트 생성 시스템
   - ResultProcessor - 결과 처리 시스템

### ✅ 지원 서비스
- Mock Project Board 서비스
- Mock Pull Request 서비스  
- Service Factory 패턴 구현

## 개발 예정 항목

### 🔴 Phase 1: Developer 인터페이스 (우선순위: 최고)
**현재 가장 중요한 미구현 컴포넌트** (Task #9)
- Worker에서 실제 AI 개발자와 통신하는 핵심 컴포넌트
- 현재 Worker의 dependencies.developer가 미구현 상태

### 🔄 Phase 2: Repository Management (우선순위: 높음) 
**Git 작업 실제 구현** (Task #4)
- Git clone, fetch, worktree 실제 구현
- 동시성 제어 메커니즘 (Task #14)
- 저장소 캐싱 전략

### 🔄 Phase 3: 실제 GitHub 서비스 통합 (우선순위: 중간)
**Mock 서비스를 실제 서비스로 전환** (Task #3)
- GitHub Projects API 실제 구현
- Pull Request API 실제 구현  
- GitHub CLI 통합

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

## 다음 단계 (우선순위 순)
1. **Developer 인터페이스 설계 및 구현** - AI 서비스와의 통합
2. Repository Management 서비스 실제 구현 - Git 작업
3. 전체 시스템 통합 테스트 - 엔드투엔드 워크플로우 검증
4. Mock 서비스를 실제 GitHub API로 전환

## Task Master 작업 상태 업데이트 필요
다음 작업들의 상태를 'done'으로 업데이트 필요:
- Task #6: Planner 컴포넌트 (완료됨)
- Task #7: Worker Pool Management (완료됨)  
- Task #8: Worker 컴포넌트 (완료됨)
- Task #10: Manager 컴포넌트 (완료됨)
- Task #11: Prompt Generation System (완료됨)
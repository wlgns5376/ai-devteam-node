# PRD 설계 흐름도

## 전체 시스템 아키텍처

```mermaid
graph TB
    subgraph "AI DevTeam System"
        PL[Planner]
        MG[Manager]
        WK[Worker]
        DV[Developer<br/>Claude Code/Gemini CLI]
        LG[Logger]
    end
    
    subgraph "External Services"
        PB[Project Board<br/>GitHub Projects]
        PR[Pull Request<br/>GitHub API]
        GIT[Git Repository]
    end
    
    PL --> MG
    MG --> WK
    WK --> DV
    WK --> MG
    MG --> PL
    
    PL <--> PB
    PL <--> PR
    WK <--> GIT
    
    PL --> LG
    MG --> LG
    WK --> LG
    DV --> LG
```

## 주요 컴포넌트 역할

### 1. Planner
- 프로젝트 보드 모니터링 (주기적)
- 작업 상태 관리 (TODO → IN_PROGRESS → IN_REVIEW → DONE)
- PR 승인/피드백 처리
- Manager와 통신

### 2. Manager
- 워크스페이스 관리
- Worker Pool 관리 (최소/최대 Worker 수)
- Worker에 작업 할당
- Worker 상태 관리

### 3. Worker
- 작업 디렉토리 생성
- Git worktree 관리
- Developer에게 프롬프트 전달
- 작업 결과 처리

### 4. Developer
- AI 개발자 (Claude Code, Gemini CLI)
- 실제 코드 작성 및 개발 작업 수행

## 작업 흐름 시나리오

### 신규 작업 흐름

```mermaid
sequenceDiagram
    participant PL as Planner
    participant PB as Project Board
    participant MG as Manager
    participant WK as Worker
    participant DV as Developer
    participant GIT as Git Repo
    
    Note over PL: 주기적 모니터링
    PL->>PB: TODO 작업 조회
    PB-->>PL: 신규 작업 목록
    
    loop 각 신규 작업
        PL->>MG: 작업 시작 요청
        MG->>MG: 사용 가능한 Worker 확인
        
        alt Worker 사용 가능
            MG->>WK: 작업 할당
            MG-->>PL: 작업 시작 확인
            PL->>PB: 상태를 IN_PROGRESS로 변경
            
            WK->>WK: 작업 디렉토리 생성
            WK->>GIT: worktree 생성
            WK->>DV: 작업 프롬프트 전달
            DV->>DV: 코드 개발 실행
            DV-->>WK: 작업 완료 + PR 링크
            
            WK-->>MG: 작업 완료 알림
            MG-->>PL: 작업 완료 + PR 링크
            PL->>PB: 상태를 IN_REVIEW로 변경
            PL->>PB: PR 링크 등록
        else Worker 없음
            MG-->>PL: Worker 부족 알림
        end
    end
```

### 진행중 작업 흐름

```mermaid
sequenceDiagram
    participant PL as Planner
    participant PB as Project Board
    participant MG as Manager
    participant WK as Worker
    participant DV as Developer
    
    Note over PL: 주기적 모니터링
    PL->>PB: IN_PROGRESS 작업 조회
    PB-->>PL: 진행중 작업 목록
    
    loop 각 진행중 작업
        PL->>MG: 작업 상태 확인
        MG->>WK: Worker 상태 확인
        
        alt Worker 진행중
            WK-->>MG: 진행중 상태
            MG-->>PL: 진행중 알림
        else Worker 대기중
            MG->>WK: 작업 재개 요청
            WK->>DV: 재개 프롬프트 전달
            Note over DV: 이후 신규작업과 동일
        end
    end
```

### 리뷰중 작업 흐름 - 승인

```mermaid
sequenceDiagram
    participant PL as Planner
    participant PB as Project Board
    participant PR as Pull Request
    participant MG as Manager
    participant WK as Worker
    participant DV as Developer
    
    Note over PL: 주기적 모니터링
    PL->>PB: IN_REVIEW 작업 조회
    PB-->>PL: 리뷰중 작업 목록
    
    loop 각 리뷰중 작업
        PL->>PR: PR 승인 여부 확인
        
        alt PR 승인됨
            PL->>MG: 병합 요청
            MG->>WK: Worker 상태 확인
            
            alt Worker 대기중
                MG->>WK: 병합 요청
                WK->>DV: 병합 프롬프트 전달
                DV->>DV: 병합 실행
                DV-->>WK: 병합 완료
                WK-->>MG: 작업 완료 알림
                MG->>MG: Worker 초기화
                MG-->>PL: 병합 완료 알림
                PL->>PB: 상태를 DONE으로 변경
            else Worker 작업중
                MG-->>PL: 작업중 알림
            end
        else PR 미승인
            Note over PL: 피드백 처리 흐름으로
        end
    end
```

### 리뷰중 작업 흐름 - 피드백

```mermaid
sequenceDiagram
    participant PL as Planner
    participant PB as Project Board
    participant PR as Pull Request
    participant MG as Manager
    participant WK as Worker
    participant DV as Developer
    
    Note over PL: 주기적 모니터링
    PL->>PB: IN_REVIEW 작업 조회
    PB-->>PL: 리뷰중 작업 목록
    
    loop 각 리뷰중 작업
        PL->>PR: 신규 코멘트 확인
        PR-->>PL: 신규 코멘트 목록
        
        alt 신규 코멘트 있음
            PL->>MG: 피드백 전달
            MG->>WK: Worker 상태 확인
            
            alt Worker 대기중
                MG->>WK: 코멘트 전달
                WK->>WK: 처리된 코멘트 필터링
                WK->>DV: 피드백 프롬프트 + 코멘트 전달
                DV->>DV: 피드백 반영 작업
                DV-->>WK: 작업 완료
                WK-->>MG: 작업 완료 알림
            else Worker 작업중
                MG-->>PL: 작업중 알림
            end
        else 신규 코멘트 없음
            Note over PL: 다음 작업으로
        end
    end
```

## 시스템 정책

### Worker Pool 관리
- Worker는 하나의 작업만 처리
- 최소/최대 Worker 수 설정
- 중지된 Worker는 특정 시간 후 대기 상태로 전환

### 동시성 처리
- 동일 저장소의 git fetch, worktree add 동시 요청 고려
- Worker Pool을 통한 리소스 관리

### 상태관리
- JSON 파일 기반 메타데이터 저장
- 향후 DB 확장 가능한 구조

## 기술 스택
- **Project Board**: GitHub Projects (기본), 향후 Jira/Notion 확장
- **Source Control**: Git, GitHub API, GitHub CLI
- **AI Developer**: Claude Code, Gemini CLI
- **State Storage**: JSON 파일, 향후 DB 확장
- **Logging**: 시스템 로깅 서비스
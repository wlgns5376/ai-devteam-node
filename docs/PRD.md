# AI DevTeam 
- Claude Code, Gemini CLI 같은 터미널 기반 서비스를 이용한 프로그램 개발 자동화 시스템


## 도구
- **프로젝트 보드**: GitHub Projects (default), 향후에 Jira, Notion 으로 확장
- **소스 코드 관리**: Git, GitHub API, GitHub CLI
- **AI 개발자(작업자)**: Claude Code, Gemini CLI
- **메타데이터, 상태저장**: JSON 파일, 향후에 DB 저장

## 역할

### Planner
- 프로젝트 보드의 작업 조회(주기적)
- 프로젝트 보드의 작업 상태 변경 (Todo -> In Progress -> In Review -> Done)
- 작업에 연결된 PR 의 승인여부, 피드백 조회 (주기적)
- Manager 에게 작업 전달


### Manager
- workspace 관리
- 작업에 해당하는 저장소 clone 또는 최신화
- Worker, Worker pool 관리
- Worker 에 작업 명령
- Worker 상태 변경
  - 유휴: 작업 할당 전
  - 대기: 작업 할당 후 추가 요청 대기
  - 작업중: 작업 진행중
  - 중지됨: 오류나 타임아웃으로 중지됨


### Worker
- 작업 디렉토리 생성 (저장소명 + 작업id)
- 저장소 worktree 생성 (브랜치명: 작업id)
- 로컬 지침 전달 (CLAUDE.local.md)
- Developer 에게 상황별 프롬프트 전달




### Developer
- Claude Code, Gemini CLI
- 프롬프트 전달 명령 실행.

### Logger
- 시스템 로깅


## 시나리오

### 작업 흐름
Planner -> Manager -> Worker -> Developer -> Worker -> Manager -> Planner


### 신규 작업
1. Planner 는 특정 주기로 프로젝트 보드에서 할일을 가져온다.
2. Manager 에게 작업을 전달한다.
3. Manager 는 Clone 된 저장소가 있는지 확인한다.
  - 없다면 git clone
  - 있다면 git pull (최신화)
4. Manager 는 작업 가능한 Worker 가 있는지 확인한다.
  - Worker 가 없다면 Planner 에게 Worker 가 없다고 전달한다.
  - Worker 가 있다면 작업 정보(작업id, 이슈번호, 작업상태, 내용, 저장소)를 전달하고 Planner 에게 작업 시작을 알린다.
5. Planner 는 작업 상태를 진행중으로 변경한다.
5. Worker 는 작업 디렉토리가 있는지 확인한다.
  - 없으면 디렉토리 생성, worktree 추가, 로컬 지침 전달
6. Worker 는 Developer 에게 작업 상태별 프롬프트를 전달한다
7. Developer 는 프롬프트를 받아서 작업을 실행한다.
8. Developer 는 작업이 끝나면 AI 로 부터 전달받은 PR 링크를 Worker 에게 전달한다.
9. Worker 는 작업이 완료되었다고 알린다.
10. Manager 는 Worker 의 작업 상태를 변경하고 작업id, PR 링크를 Worker 에게 요청한다.
10. Manager 는 Planner 에게 작업 완료를 작업id, PR 링크와 함께 전달한다.
11. Planner 는 작업id, PR 링크를 전달 받으면 해당 작업을 리뷰중으로 변경하고 작업에 PR 링크를 등록한다.


### 진행중
1. Planner 는 특정 주기로 프로젝트 보드에서 진행중인 작업을 가져온다.
2. Planner 는 Manager 에게 작업을 전달한다.
3. Manager 는 작업을 진행했던 Worker 를 찾아서 상태를 확인한다.
4. Manager 는 Worker 가 진행중이면 Planner 에게 진행중이라고 전달한다.
5. Manager 는 Worker 가 진행중이 아니면 작업 재개를 요청한다.
6. Worker 는 Developer 에게 작업 재개 프롬프트를 전달한다.
7. 이후는 신규작업 7번과 동일


### 리뷰중 - 승인
1. Planner 는 특정 주기로 프로젝트 보드에서 리뷰중인 작업을 가져온다.
2. Planner 는 작업의 PR 링크로 승인 여부를 확인하다.
3. 승인되었으면 Planner 는 Manager 에게 병합을 요청한다.
4. Manager 는 Worker 가 작업중이면 Planner 에게 작업중이라고 전달한다.
5. Manager 는 Worker 가 대기이면 병합을 요청하고 작업중으로 상태를 변경한다.
6. Worker 는 Developer 에게 병합을 요청한다.
7. 병합이 완료되면 Worker 는 Manager 에게 작업 완료를 알린다.
8. Manager 는 Worker 를 초기화하고 Planner 에게 작업 완료를 전달한다.
9. Planner 는 작업을 완료로 변경한다.

### 리뷰중 - 피드백
1. Planner 는 특정 주기로 프로젝트 보드에서 리뷰중인 작업을 가져온다.
2. Planner 는 작업의 PR 링크로 승인 여부를 확인하다.
3. 승인 전이면 Planner 는 PR 의 신규 코멘트를 조회한다.
4. 신규 코멘트가 있으면 Planner 는 Manager 에게 전달한다.
5. Manager 는 Worker 가 작업중이면 Planner 에게 작업중이라고 전달한다.
6. Manager 는 Worker 가 대기이면 코멘트를 전달하고 작업중으로 상태를 변경한다.
7. Worker 는 처리된 코멘트를 제외한 나머지 코멘트를 Developer 에게 관련 프롬프트와 함께 전달한다.
8. Developer 는 프롬프트를 받아서 작업을 진행한다.
9. Worker 가 Developer 에게 응답을 받으면 Manager 에게 작업 완료 되었다고 전달한다


## 정책

- Worker 는 하나의 작업id 만 작업한다.
- Worker pool 은 최소값과 최대값이 있다.
- Manager 는 초기에 Worker pool 의 최소값 만큼의 Worker 를 생성한다.
- 중지된 Worker 는 특정 시간이 지나면 대기로 변경한다.

## 동시성
- 동일 저장소의 git fetch, git worktree add 의 동시 요청 고려
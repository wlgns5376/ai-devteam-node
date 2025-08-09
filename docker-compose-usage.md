# Docker Compose 사용법 - Claude 인증 영속화

## 개요
이 docker-compose.yml 파일은 Claude 인증 정보를 영속화하여 컨테이너를 다시 시작해도 재인증이 필요하지 않도록 구성되었습니다.

## 주요 특징
- **Claude 인증 영속화**: `/home/appuser/.claude` 디렉토리를 Docker 볼륨으로 마운트
- **GitHub CLI 인증 영속화**: `/home/appuser/.config/gh` 디렉토리 영속화
- **Git 설정 영속화**: 글로벌 git 설정 유지
- **기존 설정 호환**: 기존 docker run 명령의 모든 설정 유지

## 사용 방법

### 1. 최초 실행
```bash
# Docker 이미지 빌드 (필요한 경우)
docker build -t ai-devteam:v0.1 .

# 서비스 시작
docker-compose up -d
```

### 2. Claude 인증 (최초 1회만)
```bash
# 컨테이너 내부로 접속
docker-compose exec ai-devteam bash

# Claude 인증 수행
claude auth login
# 또는 API 키 설정
export ANTHROPIC_API_KEY="your-api-key"
claude auth set-key

# 인증 확인
claude auth status

# 컨테이너에서 나가기
exit
```

### 3. 컨테이너 재시작 (인증 유지됨!)
```bash
# 서비스 중지
docker-compose down

# 서비스 다시 시작 - Claude 재인증 불필요!
docker-compose up -d
```

### 4. 로그 확인
```bash
# 실시간 로그 보기
docker-compose logs -f ai-devteam

# 최근 로그만 보기
docker-compose logs --tail 100 ai-devteam
```

## 영속화되는 데이터

| 볼륨명 | 마운트 경로 | 용도 |
|--------|-------------|------|
| `ai_devteam_claude_auth` | `/home/appuser/.claude` | **Claude 인증 정보** |
| `ai_devteam_gh_auth` | `/home/appuser/.config/gh` | GitHub CLI 인증 |
| `ai_devteam_git_config` | `/home/appuser/.gitconfig` | Git 전역 설정 |
| `ai_devteam_logs` | `/app/logs` | 애플리케이션 로그 |
| `ai_devteam_state` | `/app/state` | 상태 파일 |

## 볼륨 관리

### 볼륨 목록 확인
```bash
docker volume ls | grep ai_devteam
```

### 특정 볼륨 정보 확인
```bash
docker volume inspect ai_devteam_claude_auth
```

### 볼륨 백업 (Claude 인증 정보)
```bash
docker run --rm -v ai_devteam_claude_auth:/data -v $(pwd):/backup alpine tar czf /backup/claude-auth-backup.tar.gz -C /data .
```

### 볼륨 복원
```bash
docker run --rm -v ai_devteam_claude_auth:/data -v $(pwd):/backup alpine tar xzf /backup/claude-auth-backup.tar.gz -C /data
```

## 문제 해결

### Claude 인증이 유지되지 않는 경우
1. 볼륨이 제대로 마운트되었는지 확인:
```bash
docker-compose exec ai-devteam ls -la /home/appuser/.claude
```

2. 권한 문제가 있는지 확인:
```bash
docker-compose exec ai-devteam whoami
docker-compose exec ai-devteam id
```

### 완전 초기화 (모든 영속 데이터 삭제)
```bash
# 서비스 중지 및 볼륨 삭제
docker-compose down -v

# 다시 시작 (새로운 볼륨 생성)
docker-compose up -d
```

## 기존 Docker run 명령과의 차이점
- `docker run` 명령: 컨테이너 삭제 시 Claude 인증 정보도 함께 삭제됨
- `docker-compose` 방식: 볼륨을 통해 Claude 인증 정보가 영속적으로 보존됨

이제 컨테이너를 지우고 다시 실행해도 Claude 재인증이 필요하지 않습니다!
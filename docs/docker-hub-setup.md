# Docker Hub 설정 가이드

이 문서는 GitHub Actions에서 Docker Hub로 이미지를 푸시하기 위한 시크릿 설정 방법을 안내합니다.

## 필요한 GitHub Secrets

GitHub 저장소에 다음 시크릿들을 설정해야 합니다:

### 1. DOCKER_USERNAME
- Docker Hub 사용자명
- 설정 경로: Settings → Secrets and variables → Actions → New repository secret
- Name: `DOCKER_USERNAME`
- Value: Docker Hub 계정 사용자명

### 2. DOCKER_PASSWORD
- Docker Hub 액세스 토큰 (비밀번호 대신 권장)
- Docker Hub에서 액세스 토큰 생성:
  1. Docker Hub 로그인
  2. Account Settings → Security → New Access Token
  3. 토큰 이름 입력 (예: `github-actions`)
  4. 권한 선택: `Read, Write, Delete` (또는 필요에 따라 조정)
  5. Generate 클릭
  6. 생성된 토큰 복사 (한 번만 표시됨)
- 설정 경로: Settings → Secrets and variables → Actions → New repository secret
- Name: `DOCKER_PASSWORD`
- Value: 생성한 액세스 토큰

## Docker Hub 저장소 준비

1. Docker Hub에 로그인
2. 새 저장소 생성 (Create Repository)
3. 저장소 이름: `ai-devteam-node`
4. Visibility: Public 또는 Private 선택

## 워크플로우 동작 방식

1. `main` 브랜치에 푸시가 발생하면 워크플로우가 실행됩니다.
2. `package.json`의 버전을 기반으로 Git 태그와 GitHub Release를 생성합니다.
3. Docker 이미지를 빌드하고 다음 태그로 푸시합니다:
   - `latest` (main 브랜치인 경우)
   - `v1.0.0` (전체 버전)
   - `v1.0` (메이저.마이너 버전)
   - `v1` (메이저 버전)
   - `main` (브랜치명)

## 주의사항

- 이미 존재하는 버전 태그에 대해서는 릴리즈가 생성되지 않습니다.
- Docker 이미지는 `linux/amd64`와 `linux/arm64` 플랫폼을 모두 지원합니다.
- GitHub Actions 캐시를 사용하여 빌드 속도를 향상시킵니다.
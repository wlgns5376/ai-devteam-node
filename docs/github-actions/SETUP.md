# GitHub Actions 워크플로우 설정 가이드

이 문서는 AI DevTeam 프로젝트의 GitHub Actions 워크플로우 설정 방법을 설명합니다.

## 워크플로우 파일 설치

GitHub Personal Access Token에 `workflow` 권한이 필요하므로, 관리자가 직접 설치해야 합니다.

### 1. 워크플로우 디렉토리 생성

```bash
mkdir -p .github/workflows
```

### 2. 워크플로우 파일 복사

이 디렉토리의 YAML 파일들을 `.github/workflows/`로 복사합니다:

```bash
cp docs/github-actions/release.yml .github/workflows/
cp docs/github-actions/test-build.yml .github/workflows/
```

### 3. GitHub Secrets 설정

저장소 Settings → Secrets and variables → Actions에서 다음 시크릿을 추가:

- `DOCKER_USERNAME`: Docker Hub 사용자명
- `DOCKER_PASSWORD`: Docker Hub 액세스 토큰 (비밀번호 아님)

### 4. 파일 커밋 및 푸시

```bash
git add .github/workflows/
git commit -m "feat: Add GitHub Actions workflows for release and CI/CD"
git push origin main
```

## 워크플로우 설명

### release.yml
- **트리거**: main 브랜치에 푸시될 때
- **기능**: 
  - 자동 버전 태깅
  - GitHub Release 생성
  - Docker 이미지 빌드 및 푸시
  - 멀티 아키텍처 지원

### test-build.yml
- **트리거**: PR 생성 또는 main 이외 브랜치 푸시
- **기능**:
  - 의존성 설치 및 테스트
  - 코드 품질 검사 (lint, typecheck)
  - Docker 빌드 테스트

## 주의사항

- 워크플로우 파일 수정 시 `workflow` 권한이 있는 토큰 필요
- Docker Hub 액세스 토큰은 비밀번호가 아닌 별도 생성한 토큰 사용
- 첫 실행 전 package.json의 버전 확인 필요
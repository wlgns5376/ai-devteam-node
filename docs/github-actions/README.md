# GitHub Actions 워크플로우

이 디렉토리에는 GitHub Actions 워크플로우 파일들이 포함되어 있습니다.

## 워크플로우 파일

### release.yml
main 브랜치에 병합 시 자동으로 실행되는 릴리즈 및 배포 워크플로우입니다.

**주요 기능:**
- package.json 버전 기반 Git 태그 생성
- GitHub Release 자동 생성 (체인지로그 포함)
- Docker 이미지 빌드 및 Docker Hub 푸시
- 멀티 플랫폼 지원 (linux/amd64, linux/arm64)
- 자동 태깅 전략 (latest, v1.0.0, v1.0, v1, main)

### test-build.yml
PR 및 기타 브랜치에서 실행되는 테스트 및 빌드 검증 워크플로우입니다.

**주요 기능:**
- Node.js 의존성 설치 및 테스트 실행
- 린트 및 타입 체크
- Docker 이미지 빌드 테스트 (푸시하지 않음)

## 필요한 설정

GitHub 저장소 Settings → Secrets and variables → Actions에서 다음 시크릿을 설정해야 합니다:

- `DOCKER_USERNAME`: Docker Hub 사용자명
- `DOCKER_PASSWORD`: Docker Hub 액세스 토큰

## 워크플로우 파일 추가 방법

GitHub Personal Access Token에 `workflow` 권한이 필요합니다. 
관리자가 직접 추가하거나 적절한 권한을 가진 토큰을 사용해야 합니다.

```bash
# 워크플로우 파일이 있는 경우
git add .github/workflows/
git commit -m "feat: Add GitHub Actions workflows"
git push origin main
```
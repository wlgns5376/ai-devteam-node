import { 
  PromptGeneratorInterface,
  WorkerTask,
  WorkspaceInfo
} from '@/types';
import { Logger } from '../logger';

interface PromptGeneratorDependencies {
  readonly logger: Logger;
}

export class PromptGenerator implements PromptGeneratorInterface {
  constructor(
    private readonly dependencies: PromptGeneratorDependencies
  ) {}

  async generateNewTaskPrompt(task: WorkerTask, workspaceInfo: WorkspaceInfo): Promise<string> {
    this.validateInputs(task, workspaceInfo);

    const prompt = `# 새로운 작업을 시작합니다

## 작업 정보
- **작업 ID**: ${task.taskId}
- **저장소**: ${task.repositoryId}
- **작업 제목**: ${task.boardItem?.title || '제목 없음'}
- **작업 디렉토리**: ${workspaceInfo.workspaceDir}
- **브랜치**: ${workspaceInfo.branchName}
- **Base Branch**: ${task.baseBranch || 'main'}
- **이슈 번호**: #${task.boardItem.contentNumber}

### 작업 설명
${task.boardItem?.description || '작업 제목을 참고하여 적절한 구현을 진행해주세요'}

## 작업 지침
**중요**: 작업 디렉토리의 CLAUDE.local.md 파일을 반드시 참고해주세요. 해당 파일에는 프로젝트 특화 지침이 포함되어 있습니다.

## GitHub 워크플로
작업 완료 후 다음 단계를 수행해주세요:
1. **커밋**: \`git add .\` && \`git commit -m "feat(이슈 번호): [작업 설명]"\`
2. **푸시**: \`git push origin ${workspaceInfo.branchName}\`
3. **PR 생성**: \`gh pr create --title "${task.boardItem?.title || task.taskId}" --body "작업 완료 요약${task.boardItem?.contentNumber && task.boardItem?.contentType === 'issue' ? '\n\nCloses #' + task.boardItem.contentNumber : ''}"\`
4. **PR 링크 제공**: 생성된 PR 링크를 응답에 포함

## 작업 요청
위 작업을 수행하고, 완료되면 다음을 포함하여 응답해주세요:
1. **작업 진행 상황 요약**: 구현한 기능과 변경 사항
2. **PR 링크**: \`PR: https://github.com/...\` 형식으로 제공
3. **주요 변경 사항**: 추가/수정/삭제된 파일과 핵심 로직 설명
4. **테스트 결과**: 실행된 테스트와 결과 상태

작업을 시작해주세요!`;

    this.dependencies.logger.debug('Generated new task prompt', {
      taskId: task.taskId,
      promptLength: prompt.length
    });

    return prompt;
  }

  async generateResumePrompt(task: WorkerTask, workspaceInfo: WorkspaceInfo): Promise<string> {
    this.validateInputs(task, workspaceInfo);

    const prompt = `# 중단된 작업을 재개합니다

## 작업 정보
- **작업 ID**: ${task.taskId}
- **저장소**: ${task.repositoryId}
- **작업 제목**: ${task.boardItem?.title || '제목 없음'}
- **작업 디렉토리**: ${workspaceInfo.workspaceDir}
- **브랜치**: ${workspaceInfo.branchName}
- **Base Branch**: ${task.baseBranch || 'main'}
- **이슈 번호**: #${task.boardItem.contentNumber}

## 재개 지침
1. **이전 진행 상황을 확인해주세요**:
   \`\`\`bash
   cd ${workspaceInfo.workspaceDir}
   git status
   git log --oneline -10
   \`\`\`

2. **현재 상태 분석**:
   - 마지막 커밋 내용 확인
   - 변경된 파일들 검토
   - 테스트 실행 상태 확인

3. **작업 계속 진행**:
   - 이전 작업을 이어서 계속 진행해주세요
   - CLAUDE.local.md 파일의 개발 지침을 따라주세요

## GitHub 워크플로
작업 완료 후 다음 단계를 수행해주세요:
1. **커밋**: \`git add .\` && \`git commit -m "feat(이슈 번호): [추가 작업 설명]"\`
2. **푸시**: \`git push origin ${workspaceInfo.branchName}\`
3. **PR 업데이트**: 기존 PR이 있다면 자동 업데이트, 없다면 새로 생성
   - 새 PR 생성 시: \`gh pr create --title "${task.boardItem?.title || task.taskId}" --body "작업 완료 요약${task.boardItem?.contentNumber && task.boardItem?.contentType === 'issue' ? '\n\nCloses #' + task.boardItem.contentNumber : ''}"\`
4. **PR 링크 제공**: PR 링크를 응답에 포함

## 완료 요청
작업이 완료되면 다음을 포함하여 응답해주세요:
1. **이전 상태 요약**: 재개 시점의 프로젝트 상태
2. **새로 진행한 작업 내용**: 추가로 구현한 기능과 변경 사항
3. **PR 링크**: \`PR: https://github.com/...\` 형식으로 제공
4. **테스트 결과**: 실행된 테스트와 결과 상태

계속 진행해주세요!`;

    this.dependencies.logger.debug('Generated resume task prompt', {
      taskId: task.taskId,
      promptLength: prompt.length
    });

    return prompt;
  }

  async generateFeedbackPrompt(task: WorkerTask, comments: ReadonlyArray<any>): Promise<string> {
    this.validateTaskInput(task);

    if (!task.pullRequestUrl) {
      throw new Error('Pull request URL is required for merge request');
    }
    
    const prNumber = task.pullRequestUrl.split('/').pop();

    if (!comments || comments.length === 0) {
      const prompt = `# PR 리뷰 피드백을 처리합니다

## 작업 정보
- **작업 ID**: ${task.taskId}
- **저장소**: ${task.repositoryId}
- **이슈 번호**: #${task.boardItem.contentNumber}

## 상황
새로운 피드백이 없습니다. 현재 상태를 확인하고 필요한 경우 추가 작업을 진행해주세요.

## GitHub 워크플로
1. **PR 상태 확인**: \`gh pr view ${prNumber} --json state,mergeable,reviewDecision\`
2. **병합 준비 점검**: 모든 체크가 통과되었는지 확인
3. **필요시 응답**: 현재 PR 상태를 응답에 포함

현재 PR 상태를 확인하고 병합 준비가 되었는지 점검해주세요.`;

      this.dependencies.logger.debug('Generated feedback processing prompt', {
        taskId: task.taskId,
        commentCount: 0,
        promptLength: prompt.length
      });

      return prompt;
    }

    // 리뷰어들의 username을 수집하여 중복 제거
    const reviewers = new Set<string>();
    comments.forEach(comment => {
      if (comment.author && comment.author !== 'unknown') {
        reviewers.add(comment.author);
      }
    });
    
    // 리뷰어 태그 문자열 생성
    const reviewerTags = Array.from(reviewers).map(username => `@${username}`).join(' ');
    const commentMessage = reviewerTags 
      ? `${reviewerTags} 리뷰 피드백이 반영되었습니다. 재검토 부탁드립니다.`
      : '리뷰 피드백이 반영되었습니다. 재검토 부탁드립니다.';

    const commentsSection = comments.map((comment, index) => `
### 코멘트 ${index + 1}
- **작성자**: ${comment.author}
- **파일**: ${comment.metadata?.path || '전체'}${comment.metadata?.line ? `:${comment.metadata.line}` : ''}
- **내용**: ${comment.content}
- **작성일**: ${comment.createdAt}${comment.metadata?.url ? `\n- **링크**: ${comment.metadata.url}` : ''}
`).join('\n');

    const prompt = `# PR 리뷰 피드백을 처리합니다

## 작업 정보
- **작업 ID**: ${task.taskId}
- **저장소**: ${task.repositoryId}
- **이슈 번호**: #${task.boardItem.contentNumber}
- **피드백 수**: 총 ${comments.length}개의 코멘트

## 받은 피드백
${commentsSection}

## 처리 지침
1. **각 피드백을 순서대로 검토하고 수정해주세요**
2. **CLAUDE.local.md 파일의 개발 지침을 따라 수정 작업을 진행해주세요**
3. **수정 사항에 대한 테스트도 함께 업데이트해주세요**

## GitHub 워크플로
피드백 처리 완료 후 다음 단계를 수행해주세요:
1. **커밋**: \`git add .\` && \`git commit -m "fix(이슈 번호): 리뷰 피드백 반영"\`
2. **푸시**: \`git push origin ${task.taskId}\`
3. **댓글 작성**: \`gh pr comment ${prNumber} --body "${commentMessage}"\`

## 완료 요청
모든 피드백을 처리한 후 다음을 포함하여 응답해주세요:
1. **처리한 피드백 요약**: 각 코멘트별 수정 내용
2. **주요 변경 사항**: 수정된 파일과 핵심 변경점
3. **테스트 결과**: 실행된 테스트와 결과 상태
4. **추가 커밋 정보**: 생성된 커밋 메시지와 해시

피드백을 처리해주세요!`;

    this.dependencies.logger.debug('Generated feedback processing prompt', {
      taskId: task.taskId,
      commentCount: comments.length,
      reviewerCount: reviewers.size,
      promptLength: prompt.length
    });

    return prompt;
  }

  async generateMergePrompt(task: WorkerTask): Promise<string> {
    this.validateTaskInput(task);

    if (!task.pullRequestUrl) {
      throw new Error('Pull request URL is required for merge request');
    }

    // PR URL에서 PR 번호 추출 (예: https://github.com/owner/repo/pull/123)
    const prNumber = task.pullRequestUrl.split('/').pop();
    const branchName = task.boardItem?.contentNumber 
      ? `${task.boardItem.contentType === 'pull_request' ? 'pr' : 'issue'}-${task.boardItem.contentNumber}`
      : task.taskId;

    const prompt = `# PR 병합을 진행합니다

## 작업 정보
- **작업 ID**: ${task.taskId}
- **저장소**: ${task.repositoryId}
- **PR URL**: ${task.pullRequestUrl}
- **작업 제목**: ${task.boardItem?.title || 'PR 병합'}
- **브랜치**: ${branchName}

## GitHub CLI를 통한 병합
1. **PR 상태 확인**:
   \`\`\`bash
   gh pr view ${prNumber} --json state,mergeable,reviewDecision,statusCheckRollup
   \`\`\`

2. **병합 실행**:
   \`\`\`bash
   # GitHub CLI를 통한 병합 (권장)
   gh pr merge ${prNumber} --merge --delete-branch
   
   # 또는 수동 병합이 필요한 경우
   git checkout main
   git pull origin main
   git merge ${branchName}
   git push origin main
   git branch -d ${branchName}
   git push origin --delete ${branchName}
   \`\`\`

3. **충돌 발생시 처리**:
   - \`gh pr view ${prNumber} --json mergeable\` 로 병합 가능 여부 확인
   - 충돌이 있으면 로컬에서 해결 후 다시 푸시
   - 테스트 재실행 및 검증

4. **병합 완료 후 정리**:
   - 브랜치 자동 삭제 확인
   - 관련 이슈가 있다면 자동 종료 확인

## 완료 요청
병합이 완료되면 다음을 포함하여 응답해주세요:
1. **병합 결과**: 성공 여부와 병합 방식
2. **발생한 충돌과 해결 방법**: 충돌이 있었다면 해결 과정
3. **최종 테스트 결과**: 병합 후 테스트 실행 결과
4. **정리 완료 상태**: 브랜치 삭제 및 이슈 종료 상태

병합을 진행해주세요!`;

    this.dependencies.logger.debug('Generated merge request prompt', {
      taskId: task.taskId,
      promptLength: prompt.length
    });

    return prompt;
  }

  private validateInputs(task: WorkerTask, workspaceInfo: WorkspaceInfo): void {
    this.validateTaskInput(task);
    
    if (!workspaceInfo) {
      throw new Error('WorkspaceInfo is required');
    }
    
    if (!workspaceInfo.taskId || workspaceInfo.taskId.trim() === '') {
      throw new Error('Invalid workspace: taskId cannot be empty');
    }
    
    if (!workspaceInfo.workspaceDir || workspaceInfo.workspaceDir.trim() === '') {
      throw new Error('Invalid workspace: workspaceDir cannot be empty');
    }
  }

  private validateTaskInput(task: WorkerTask): void {
    if (!task) {
      throw new Error('Task is required');
    }
    
    if (!task.taskId || task.taskId.trim() === '') {
      throw new Error('Invalid task: taskId cannot be empty');
    }
    
    if (!task.repositoryId || task.repositoryId.trim() === '') {
      throw new Error('Invalid task: repositoryId cannot be empty');
    }
    
    if (!task.action) {
      throw new Error('Invalid task: action is required');
    }
  }
}
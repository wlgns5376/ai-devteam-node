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
- **작업 설명**: ${task.boardItem?.description || '작업 제목을 참고하여 적절한 구현을 진행해주세요'}
- **작업 디렉토리**: ${workspaceInfo.workspaceDir}
- **브랜치**: ${workspaceInfo.branchName}

## 개발 환경
- **언어**: Node.js 20+, TypeScript
- **테스트**: Jest
- **패키지 관리**: pnpm

## 작업 지침
**중요**: 작업 디렉토리의 CLAUDE.local.md 파일을 반드시 참고해주세요. 해당 파일에는 프로젝트 특화 지침이 포함되어 있습니다.

### 개발 방식
1. **TDD 방식으로 개발해주세요**:
   - 먼저 테스트 코드를 작성
   - 테스트 실행하여 실패 확인 (Red)
   - 테스트를 통과하는 코드 작성 (Green)
   - 리팩토링 (Refactor)

2. **품질 기준**:
   - 테스트 커버리지 80% 이상 유지
   - SOLID 원칙 준수
   - Clean Code 원칙 적용
   - TypeScript 엄격 모드 준수

3. **작업 완료 기준**:
   - 모든 테스트 통과
   - 린트 에러 없음
   - 타입 에러 없음
   - PR 생성 완료

## 작업 요청
위 작업을 수행하고, 완료되면 다음을 포함하여 응답해주세요:
1. 작업 진행 상황 요약
2. 생성된 PR 링크 (형식: "PR: https://github.com/...")
3. 주요 변경 사항
4. 테스트 결과

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
   - TDD 방식 유지
   - 테스트 커버리지 80% 이상 유지

## 완료 요청
작업이 완료되면 다음을 포함하여 응답해주세요:
1. 이전 상태 요약
2. 새로 진행한 작업 내용
3. PR 링크 (형식: "PR: https://github.com/...")
4. 테스트 결과

계속 진행해주세요!`;

    this.dependencies.logger.debug('Generated resume task prompt', {
      taskId: task.taskId,
      promptLength: prompt.length
    });

    return prompt;
  }

  async generateFeedbackPrompt(task: WorkerTask, comments: ReadonlyArray<any>): Promise<string> {
    this.validateTaskInput(task);

    if (!comments || comments.length === 0) {
      const prompt = `# PR 리뷰 피드백을 처리합니다

## 작업 정보
- **작업 ID**: ${task.taskId}
- **저장소**: ${task.repositoryId}

## 상황
새로운 피드백이 없습니다. 현재 상태를 확인하고 필요한 경우 추가 작업을 진행해주세요.

현재 PR 상태를 확인하고 병합 준비가 되었는지 점검해주세요.`;

      this.dependencies.logger.debug('Generated feedback processing prompt', {
        taskId: task.taskId,
        commentCount: 0,
        promptLength: prompt.length
      });

      return prompt;
    }

    const commentsSection = comments.map((comment, index) => `
### 코멘트 ${index + 1}
- **작성자**: ${comment.author}
- **파일**: ${comment.path}${comment.line ? `:${comment.line}` : ''}
- **내용**: ${comment.body}
- **작성일**: ${comment.createdAt}
`).join('\n');

    const prompt = `# PR 리뷰 피드백을 처리합니다

## 작업 정보
- **작업 ID**: ${task.taskId}
- **저장소**: ${task.repositoryId}
- **피드백 수**: 총 ${comments.length}개의 코멘트

## 받은 피드백
${commentsSection}

## 처리 지침
1. **각 피드백을 순서대로 검토하고 수정해주세요**
2. **TDD 방식을 유지하며 수정 작업을 진행해주세요**
3. **수정 사항에 대한 테스트도 함께 업데이트해주세요**
4. **테스트 커버리지 80% 이상을 유지해주세요**

## 완료 요청
모든 피드백을 처리한 후 다음을 포함하여 응답해주세요:
1. 처리한 피드백 요약
2. 주요 변경 사항
3. 테스트 결과
4. 추가 커밋 정보

피드백을 처리해주세요!`;

    this.dependencies.logger.debug('Generated feedback processing prompt', {
      taskId: task.taskId,
      commentCount: comments.length,
      promptLength: prompt.length
    });

    return prompt;
  }

  async generateMergePrompt(task: WorkerTask): Promise<string> {
    this.validateTaskInput(task);

    const prompt = `# PR 병합을 진행합니다

## 작업 정보
- **작업 ID**: ${task.taskId}
- **저장소**: ${task.repositoryId}
- **작업 제목**: ${task.boardItem?.title || 'PR 병합'}

## 병합 지침
1. **현재 PR 상태를 확인해주세요**:
   - 모든 체크가 통과되었는지 확인
   - 충돌이 없는지 확인
   - 리뷰 승인이 완료되었는지 확인

2. **병합 실행**:
   \`\`\`bash
   # 최신 main 브랜치로 전환
   git checkout main
   git pull origin main
   
   # 작업 브랜치 병합
   git merge ${task.taskId}
   
   # 병합 완료 후 원격 저장소에 푸시
   git push origin main
   \`\`\`

3. **충돌이 발생하면**:
   - 충돌을 해결해주세요
   - 테스트를 다시 실행해주세요
   - 문제가 없으면 병합을 계속 진행해주세요

4. **병합 완료 후**:
   - 작업 브랜치 정리
   - 관련 이슈 종료

## 완료 요청
병합이 완료되면 다음을 포함하여 응답해주세요:
1. 병합 결과
2. 발생한 충돌과 해결 방법 (있는 경우)
3. 최종 테스트 결과
4. 정리 완료 상태

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
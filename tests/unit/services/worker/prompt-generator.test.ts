import { PromptGenerator } from '@/services/worker/prompt-generator';
import { Logger } from '@/services/logger';
import { 
  WorkerTask, 
  WorkerAction,
  PromptGeneratorInterface,
  WorkspaceInfo
} from '@/types';

describe('PromptGenerator', () => {
  let promptGenerator: PromptGenerator;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    // Given: Mock 의존성 설정
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    promptGenerator = new PromptGenerator({
      logger: mockLogger
    });
  });

  describe('신규 작업 프롬프트', () => {
    it('작업 정보를 포함한 프롬프트를 생성해야 한다', async () => {
      // Given: 새 작업 정보
      const task: WorkerTask = {
        taskId: 'task-123',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        boardItem: {
          id: 'task-123',
          title: 'Implement user authentication',
          description: 'Add JWT-based authentication system'
        }
      };

      const workspaceInfo: WorkspaceInfo = {
        taskId: 'task-123',
        repositoryId: 'owner/repo',
        workspaceDir: '/workspace/owner_repo_task-123',
        branchName: 'task-123',
        worktreeCreated: true,
        claudeLocalPath: '/workspace/owner_repo_task-123/CLAUDE.local.md',
        createdAt: new Date()
      };

      // When: 신규 작업 프롬프트 생성
      const prompt = await promptGenerator.generateNewTaskPrompt(task, workspaceInfo);

      // Then: 완전한 프롬프트가 생성됨
      expect(prompt).toContain('새로운 작업을 시작합니다');
      expect(prompt).toContain(task.taskId);
      expect(prompt).toContain(task.boardItem.title);
      expect(prompt).toContain(task.boardItem.description);
      expect(prompt).toContain(workspaceInfo.workspaceDir);
      expect(prompt).toContain('GitHub 워크플로');
      expect(prompt).toContain('gh pr create');
      expect(prompt).toContain('PR 링크');
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Generated new task prompt',
        { taskId: task.taskId, promptLength: prompt.length }
      );
    });

    it('작업 설명이 없어도 프롬프트를 생성해야 한다', async () => {
      // Given: 설명 없는 작업
      const task: WorkerTask = {
        taskId: 'task-no-desc',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        boardItem: {
          id: 'task-no-desc',
          title: 'Fix bug'
        }
      };

      const workspaceInfo: WorkspaceInfo = {
        taskId: 'task-no-desc',
        repositoryId: 'owner/repo',
        workspaceDir: '/workspace/owner_repo_task-no-desc',
        branchName: 'task-no-desc',
        worktreeCreated: true,
        claudeLocalPath: '/workspace/owner_repo_task-no-desc/CLAUDE.local.md',
        createdAt: new Date()
      };

      // When: 프롬프트 생성
      const prompt = await promptGenerator.generateNewTaskPrompt(task, workspaceInfo);

      // Then: 기본 프롬프트가 생성됨
      expect(prompt).toContain('새로운 작업을 시작합니다');
      expect(prompt).toContain(task.boardItem.title);
      expect(prompt).toContain('작업 제목을 참고하여');
    });
  });

  describe('재개 프롬프트', () => {
    it('이전 작업 상태를 포함한 재개 프롬프트를 생성해야 한다', async () => {
      // Given: 재개할 작업
      const task: WorkerTask = {
        taskId: 'task-resume',
        action: WorkerAction.RESUME_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        boardItem: {
          id: 'task-resume',
          title: 'Continue development',
          description: 'Resume previous work'
        }
      };

      const workspaceInfo: WorkspaceInfo = {
        taskId: 'task-resume',
        repositoryId: 'owner/repo',
        workspaceDir: '/workspace/owner_repo_task-resume',
        branchName: 'task-resume',
        worktreeCreated: true,
        claudeLocalPath: '/workspace/owner_repo_task-resume/CLAUDE.local.md',
        createdAt: new Date()
      };

      // When: 재개 프롬프트 생성
      const prompt = await promptGenerator.generateResumePrompt(task, workspaceInfo);

      // Then: 재개 프롬프트가 생성됨
      expect(prompt).toContain('중단된 작업을 재개합니다');
      expect(prompt).toContain(task.taskId);
      expect(prompt).toContain('이전 진행 상황을 확인');
      expect(prompt).toContain('git status');
      expect(prompt).toContain('git log');
      expect(prompt).toContain('GitHub 워크플로');
      expect(prompt).toContain('계속 진행해주세요');
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Generated resume task prompt',
        { taskId: task.taskId, promptLength: prompt.length }
      );
    });
  });

  describe('피드백 프롬프트', () => {
    it('PR 코멘트를 포함한 수정 프롬프트를 생성해야 한다', async () => {
      // Given: 피드백이 있는 작업
      const task: WorkerTask = {
        taskId: 'task-feedback',
        action: WorkerAction.PROCESS_FEEDBACK,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        boardItem: {
          id: 'task-feedback',
          title: 'Fix issues based on review'
        }
      };

      const comments = [
        {
          id: 'comment-1',
          content: '이 함수의 성능을 개선해주세요',
          author: 'reviewer1',
          createdAt: new Date(),
          metadata: {
            type: 'review_comment',
            path: 'src/auth.ts',
            line: 42,
            url: 'https://github.com/owner/repo/pull/123#issuecomment-123456'
          }
        },
        {
          id: 'comment-2',
          content: '테스트 케이스를 추가해주세요',
          author: 'reviewer2',
          createdAt: new Date(),
          metadata: {
            type: 'review_comment',
            path: 'tests/auth.test.ts',
            line: 15,
            url: 'https://github.com/owner/repo/pull/123#issuecomment-123457'
          }
        }
      ];

      // When: 피드백 프롬프트 생성
      const prompt = await promptGenerator.generateFeedbackPrompt(task, comments);

      // Then: 피드백 프롬프트가 생성됨
      expect(prompt).toContain('PR 리뷰 피드백을 처리합니다');
      expect(prompt).toContain(task.taskId);
      expect(prompt).toContain('총 2개의 코멘트');
      expect(prompt).toContain('이 함수의 성능을 개선해주세요');
      expect(prompt).toContain('테스트 케이스를 추가해주세요');
      expect(prompt).toContain('src/auth.ts:42');
      expect(prompt).toContain('tests/auth.test.ts:15');
      expect(prompt).toContain('reviewer1');
      expect(prompt).toContain('reviewer2');
      expect(prompt).toContain('GitHub 워크플로');
      expect(prompt).toContain('gh pr comment');
      expect(prompt).toContain('https://github.com/owner/repo/pull/123#issuecomment-123456');
      expect(prompt).toContain('https://github.com/owner/repo/pull/123#issuecomment-123457');
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Generated feedback processing prompt',
        { taskId: task.taskId, commentCount: 2, promptLength: prompt.length }
      );
    });

    it('코멘트가 없으면 적절한 메시지를 포함해야 한다', async () => {
      // Given: 코멘트 없는 피드백 작업
      const task: WorkerTask = {
        taskId: 'task-no-feedback',
        action: WorkerAction.PROCESS_FEEDBACK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      // When: 빈 코멘트로 프롬프트 생성
      const prompt = await promptGenerator.generateFeedbackPrompt(task, []);

      // Then: 코멘트 없음 메시지 포함
      expect(prompt).toContain('새로운 피드백이 없습니다');
      expect(prompt).toContain('현재 상태를 확인');
      expect(prompt).toContain('GitHub 워크플로');
      expect(prompt).toContain('gh pr view');
    });

    it('코멘트에 URL이 없어도 프롬프트를 생성해야 한다', async () => {
      // Given: URL이 없는 피드백 작업
      const task: WorkerTask = {
        taskId: 'task-no-url',
        action: WorkerAction.PROCESS_FEEDBACK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      };

      const comments = [
        {
          id: 'comment-1',
          content: '이 함수를 개선해주세요',
          author: 'reviewer1',
          createdAt: new Date(),
          metadata: {
            type: 'review_comment',
            path: 'src/utils.ts',
            line: 10
            // url이 없는 경우
          }
        }
      ];

      // When: 피드백 프롬프트 생성
      const prompt = await promptGenerator.generateFeedbackPrompt(task, comments);

      // Then: URL 없이도 프롬프트가 생성됨
      expect(prompt).toContain('이 함수를 개선해주세요');
      expect(prompt).toContain('src/utils.ts:10');
      expect(prompt).toContain('reviewer1');
      expect(prompt).not.toContain('링크:');
    });
  });

  describe('병합 프롬프트', () => {
    it('병합 요청 프롬프트를 생성해야 한다', async () => {
      // Given: 병합 요청 작업
      const task: WorkerTask = {
        taskId: 'task-merge',
        action: WorkerAction.MERGE_REQUEST,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        boardItem: {
          id: 'task-merge',
          title: 'Merge approved PR'
        }
      };

      // When: 병합 프롬프트 생성
      const prompt = await promptGenerator.generateMergePrompt(task);

      // Then: 병합 프롬프트가 생성됨
      expect(prompt).toContain('PR 병합을 진행합니다');
      expect(prompt).toContain(task.taskId);
      expect(prompt).toContain('GitHub CLI를 통한 병합');
      expect(prompt).toContain('gh pr merge');
      expect(prompt).toContain('gh pr view');
      expect(prompt).toContain('충돌 발생시 처리');
      expect(prompt).toContain('병합 완료 후 정리');
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Generated merge request prompt',
        { taskId: task.taskId, promptLength: prompt.length }
      );
    });
  });

  describe('프롬프트 구성 요소', () => {
    it('모든 프롬프트에 공통 지침이 포함되어야 한다', async () => {
      // Given: 기본 작업
      const task: WorkerTask = {
        taskId: 'task-common',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date(),
        boardItem: {
          id: 'task-common',
          title: 'Test task'
        }
      };

      const workspaceInfo: WorkspaceInfo = {
        taskId: 'task-common',
        repositoryId: 'owner/repo',
        workspaceDir: '/workspace/test',
        branchName: 'task-common',
        worktreeCreated: true,
        claudeLocalPath: '/workspace/test/CLAUDE.local.md',
        createdAt: new Date()
      };

      // When: 프롬프트 생성
      const prompt = await promptGenerator.generateNewTaskPrompt(task, workspaceInfo);

      // Then: 공통 지침 포함  
      expect(prompt).toContain('CLAUDE.local.md 파일을 반드시 참고');
      expect(prompt).toContain('GitHub 워크플로');
      expect(prompt).toContain('작업 요청');
    });

    it('잘못된 입력에 대해 에러를 발생시켜야 한다', async () => {
      // Given: 유효하지 않은 작업
      const invalidTask = {
        taskId: '',
        action: WorkerAction.START_NEW_TASK,
        repositoryId: 'owner/repo',
        assignedAt: new Date()
      } as WorkerTask;

      const workspaceInfo: WorkspaceInfo = {
        taskId: 'test',
        repositoryId: 'owner/repo',
        workspaceDir: '/workspace/test',
        branchName: 'test',
        worktreeCreated: true,
        claudeLocalPath: '/workspace/test/CLAUDE.local.md',
        createdAt: new Date()
      };

      // When & Then: 에러 발생
      await expect(
        promptGenerator.generateNewTaskPrompt(invalidTask, workspaceInfo)
      ).rejects.toThrow('Invalid task: taskId cannot be empty');
    });
  });
});
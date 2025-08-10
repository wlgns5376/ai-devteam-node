import { WorkerPoolManager } from './services/manager/worker-pool-manager';
import { Worker } from './services/worker/worker';
import { DeveloperFactory } from './services/developer/developer-factory';
import { Logger, LogLevel } from './services/logger';
import { StateManager } from './services/state-manager';
import { MockProjectBoardService } from './services/project-board/mock/mock-project-board';
import { MockPullRequestService } from './services/pull-request/mock/mock-pull-request';
import { WorkerAction } from '@/types';

async function runDemo() {
  console.log('🚀 AI DevTeam 워크플로우 데모 시작\n');

  // 1. 의존성 초기화
  const logger = new Logger({
    level: LogLevel.INFO,
    enableConsole: true
  });
  const stateManager = new StateManager('./temp-state');
  
  // Mock 서비스들
  const projectBoard = new MockProjectBoardService();
  const pullRequestService = new MockPullRequestService();

  // 2. Worker Pool Manager 초기화
  const developerConfig = {
    timeoutMs: 30000,
    maxRetries: 3,
    retryDelayMs: 1000,
    mock: {
      responseDelay: 1000
    }
  };

  const workerPoolManager = new WorkerPoolManager(
    {
      workspaceBasePath: './temp-workspace',
      minWorkers: 2,
      maxWorkers: 5,
      workerRecoveryTimeoutMs: 30000,
      gitOperationTimeoutMs: 60000,
      repositoryCacheTimeoutMs: 300000
    },
    { logger, stateManager, developerConfig }
  );

  // 3. Mock 작업 데이터 준비
  console.log('📋 1. Mock 데이터 준비...');
  console.log('✅ Mock 작업 준비 완료\n');

  // 4. Developer 생성
  const developer = DeveloperFactory.create('mock', {
    timeoutMs: 30000,
    maxRetries: 3,
    retryDelayMs: 1000,
    mock: {
      responseDelay: 1000
    }
  }, { logger });

  try {
    console.log('🏗️ 2. 시스템 초기화...');
    
    // Worker Pool 초기화
    await workerPoolManager.initializePool();
    console.log('✅ Worker Pool 초기화 완료');

    // Developer 초기화
    await developer.initialize();
    console.log('✅ Developer 초기화 완료\n');

    console.log('🔄 3. 신규 작업 워크플로우 실행...\n');

    // 3-1. Mock 작업 조회
    console.log('📋 프로젝트 보드에서 작업 조회 중...');
    const tasks = await projectBoard.getItems('board-1', 'TODO');
    console.log(`✅ ${tasks.length}개의 TODO 작업 발견`);

    if (tasks.length === 0) {
      console.log('❌ 처리할 작업이 없습니다.');
      return;
    }

    const task = tasks[0];
    if (!task) {
      console.log('❌ 첫 번째 작업을 찾을 수 없습니다.');
      return;
    }
    console.log(`📝 처리할 작업: ${task.title}\n`);

    // 3-2. Manager가 Worker 확인
    console.log('👷 Manager: 사용 가능한 Worker 확인 중...');
    const availableWorker = await workerPoolManager.getAvailableWorker();
    
    if (!availableWorker) {
      console.log('❌ 사용 가능한 Worker가 없습니다.');
      return;
    }

    console.log(`✅ Worker 할당: ${availableWorker.id}`);

    // 3-3. Worker에 작업 할당
    console.log('\n🔧 Worker: 작업 준비 중...');
    await workerPoolManager.assignWorker(availableWorker.id, task.id);
    
    // Developer 어댑터 생성 (Worker 인터페이스에 맞춤)
    const developerAdapter = {
      async executePrompt(prompt: string, workspaceDir: string): Promise<string> {
        const output = await developer.executePrompt(prompt, workspaceDir);
        return output.rawOutput;
      },
      async isAvailable(): Promise<boolean> {
        return await developer.isAvailable();
      },
      getType(): 'claude' | 'gemini' {
        return 'claude';
      }
    };
    
    // Worker 인스턴스 생성 (실제로는 WorkerPool에서 관리)
    const worker = new Worker(
      availableWorker.id,
      availableWorker.workspaceDir,
      'claude',
      {
        logger,
        workspaceSetup: {
          prepareWorkspace: async (task) => ({
            workspaceDir: availableWorker.workspaceDir,
            repositoryPath: './temp-repo',
            branchName: `feature/${task.taskId}`
          }),
          validateEnvironment: async () => true,
          cleanupWorkspace: async () => {}
        },
        developer: developerAdapter,
        promptGenerator: {
          generateNewTaskPrompt: async (task, workspace) => 
            `새로운 작업을 시작합니다: ${task.taskId}\n설명: ${task.boardItem?.description || 'No description'}\n작업 디렉토리: ${workspace.workspaceDir}`,
          generateResumePrompt: async () => '작업을 재개합니다.',
          generateFeedbackPrompt: async () => '피드백을 처리합니다.',
          generateMergePrompt: async () => 'PR을 병합합니다.'
        },
        resultProcessor: {
          processOutput: async (output: string, task) => {
            const prUrl = output.match(/https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+/)?.[0];
            const result = {
              taskId: task.taskId,
              success: output.includes('성공') || output.includes('완료'),
              completedAt: new Date()
            } as any;
            
            if (prUrl) {
              result.pullRequestUrl = prUrl;
            }
            
            return result;
          },
          extractPullRequestUrl: (output: string) => 
            output.match(/https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+/)?.[0] || null,
          extractErrorInfo: () => null,
          generateStatusReport: async () => ({})
        }
      }
    );

    // 3-4. 작업 할당 및 실행
    await worker.assignTask({
      taskId: task.id,
      action: WorkerAction.START_NEW_TASK,
      boardItem: task,
      assignedAt: new Date(),
      repositoryId: 'test-repo'
    });

    console.log('🚀 Worker: 작업 실행 시작...');
    const result = await worker.startExecution();

    console.log('\n✅ 작업 실행 완료!');
    console.log(`📋 성공 여부: ${result.success}`);
    if (result.pullRequestUrl) {
      console.log(`🔗 PR 링크: ${result.pullRequestUrl}`);
    }
    if (result.errorMessage) {
      console.log(`❌ 에러: ${result.errorMessage}`);
    }

    // 3-5. 작업 상태 업데이트
    console.log('\n📋 작업 상태 업데이트 중...');
    
    if (result.success) {
      await projectBoard.updateItemStatus(task.id, 'in-review');
      console.log('✅ 작업 상태를 "리뷰중"으로 변경');
    } else {
      await projectBoard.updateItemStatus(task.id, 'todo');
      console.log('❌ 작업 실패 - 상태를 "할일"로 되돌림');
    }

    // 3-6. Worker 해제
    console.log('\n🧹 정리 작업...');
    await workerPoolManager.releaseWorker(availableWorker.id);
    console.log('✅ Worker 해제 완료');

    // 최종 상태 확인
    console.log('\n📊 최종 상태:');
    const poolStatus = workerPoolManager.getPoolStatus();
    console.log(`👷 Worker Pool: ${poolStatus.activeWorkers}/${poolStatus.workers.length} (활성/전체)`);
    
    const updatedTasks = await projectBoard.getItems('board-1');
    console.log('📋 작업 현황:');
    updatedTasks.forEach(t => {
      console.log(`  - ${t.title}: ${t.status}`);
    });

  } catch (error) {
    console.error('\n❌ 에러 발생:', error);
  } finally {
    console.log('\n🧹 최종 정리...');
    await developer.cleanup();
    await workerPoolManager.shutdown();
    console.log('✅ 데모 완료');
  }
}

// 데모 실행
runDemo().catch(console.error);
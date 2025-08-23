import { 
  PlannerServiceConfig, 
  PlannerStatus, 
  PlannerService,
  PlannerDependencies
} from '@/types';

// 리팩토링된 컴포넌트들 import
import { WorkflowStateManager } from './planner/workflow-state-manager';
import { PlannerErrorManager } from './planner/planner-error-manager';
import { WorkflowInitializer } from './planner/workflow-initializer';
import { NewTaskHandler } from './planner/new-task-handler';
import { InProgressTaskHandler } from './planner/in-progress-task-handler';
import { ReviewTaskHandler } from './planner/review-task-handler';

/**
 * 리팩토링된 Planner 클래스
 * 각 영역별 전문 클래스들을 조합하여 워크플로우를 관리
 * - 단일 책임 원칙 적용
 * - 테스트 가능성 향상
 * - 코드 재사용성 개선
 */
export class Planner implements PlannerService {
  private monitoringTimer: NodeJS.Timeout | undefined;
  private totalTasksProcessed = 0;

  // 리팩토링된 컴포넌트들
  private readonly workflowStateManager: WorkflowStateManager;
  private readonly errorManager: PlannerErrorManager;
  private readonly workflowInitializer: WorkflowInitializer;
  private readonly newTaskHandler: NewTaskHandler;
  private readonly inProgressTaskHandler: InProgressTaskHandler;
  private readonly reviewTaskHandler: ReviewTaskHandler;

  constructor(
    private readonly config: PlannerServiceConfig,
    private readonly dependencies: PlannerDependencies
  ) {
    // 컴포넌트 초기화
    this.workflowStateManager = new WorkflowStateManager(this.dependencies.logger);
    this.errorManager = new PlannerErrorManager(this.dependencies.logger);
    
    this.workflowInitializer = new WorkflowInitializer(
      this.config,
      this.dependencies,
      this.workflowStateManager,
      this.errorManager,
      this.dependencies.logger
    );
    
    this.newTaskHandler = new NewTaskHandler(
      this.config,
      this.dependencies,
      this.workflowStateManager,
      this.errorManager,
      this.dependencies.logger
    );
    
    this.inProgressTaskHandler = new InProgressTaskHandler(
      this.config,
      this.dependencies,
      this.workflowStateManager,
      this.errorManager,
      this.dependencies.logger
    );
    
    this.reviewTaskHandler = new ReviewTaskHandler(
      this.config,
      this.dependencies,
      this.workflowStateManager,
      this.errorManager,
      this.dependencies.logger
    );
  }

  async startMonitoring(): Promise<void> {
    if (this.monitoringTimer) {
      return; // 이미 모니터링 중
    }

    // 모니터링 시작 전 기존 작업 상태 복원
    await this.workflowInitializer.initialize();

    const stats = this.workflowStateManager.getStats();
    this.dependencies.logger.info('Planner monitoring started', {
      boardId: this.config.boardId,
      interval: this.config.monitoringIntervalMs,
      restoredProcessedTasks: stats.processedTasksCount,
      restoredActiveTasks: stats.activeTasksCount
    });

    this.monitoringTimer = setInterval(
      () => this.processWorkflowCycle(),
      this.config.monitoringIntervalMs
    );
  }

  async stopMonitoring(): Promise<void> {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = undefined;
      
      this.dependencies.logger.info('Planner monitoring stopped');
    }
  }

  isRunning(): boolean {
    return this.monitoringTimer !== undefined;
  }

  getStatus(): PlannerStatus {
    const stats = this.workflowStateManager.getStats();
    return {
      isRunning: this.isRunning(),
      lastSyncTime: stats.lastSyncTime,
      totalTasksProcessed: this.totalTasksProcessed,
      activeTasks: stats.activeTasksCount,
      errors: this.errorManager.getAllErrors()
    };
  }

  async forceSync(): Promise<void> {
    await this.processWorkflowCycle();
  }

  async processWorkflowCycle(): Promise<void> {
    try {
      this.dependencies.logger.debug('Starting workflow cycle');

      // 각 핸들러를 순차적으로 실행
      const processedNewTasks = await this.newTaskHandler.handle();
      this.totalTasksProcessed += processedNewTasks;

      await this.inProgressTaskHandler.handle();
      await this.reviewTaskHandler.handle();

      // StateManager에 lastSyncTime 저장
      const now = new Date();
      await this.dependencies.stateManager.updateLastSyncTime(now);
      this.workflowStateManager.updateLastSyncTime(now);
      
      const stats = this.workflowStateManager.getStats();
      this.dependencies.logger.debug('Workflow cycle completed', {
        lastSyncTime: now,
        activeTasks: stats.activeTasksCount
      });

    } catch (error) {
      this.errorManager.addError(
        'WORKFLOW_CYCLE_ERROR',
        error instanceof Error ? error.message : 'Unknown workflow error',
        { error }
      );
      
      this.dependencies.logger.error('Workflow cycle error', {
        error: error instanceof Error ? error.message : 'Unknown workflow error'
      });
    }
  }

  // 하위 호환성을 위해 기존 메서드들을 유지하되 새로운 핸들러들에 위임
  async handleNewTasks(): Promise<void> {
    const processedCount = await this.newTaskHandler.handle();
    this.totalTasksProcessed += processedCount;
  }

  async handleInProgressTasks(): Promise<void> {
    await this.inProgressTaskHandler.handle();
  }

  async handleReviewTasks(): Promise<void> {
    await this.reviewTaskHandler.handle();
  }
}
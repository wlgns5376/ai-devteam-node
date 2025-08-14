import { 
  PlannerServiceConfig,
  PlannerDependencies
} from '@/types';
import { WorkflowStateManager } from './workflow-state-manager';
import { PlannerErrorManager } from './planner-error-manager';
import { Logger } from '@/services/logger';

/**
 * 워크플로우 초기화를 담당하는 클래스
 * - 프로젝트 보드 상태 조회
 * - 기존 작업 상태 복원
 * - 워크플로우 상태 초기화
 */
export class WorkflowInitializer {
  constructor(
    private readonly config: PlannerServiceConfig,
    private readonly dependencies: PlannerDependencies,
    private readonly workflowStateManager: WorkflowStateManager,
    private readonly errorManager: PlannerErrorManager,
    private readonly logger: Logger
  ) {}

  /**
   * 워크플로우 상태 초기화
   * 시작 시 기존 프로젝트 보드 상태를 기반으로 워크플로우 상태를 초기화
   */
  async initialize(): Promise<void> {
    try {
      this.logger.debug('Initializing workflow state from project board');

      // 모든 상태의 작업 조회
      const [todoItems, inProgressItems, inReviewItems, doneItems] = await this.getAllBoardItems();

      // 워크플로우 상태 복원
      this.workflowStateManager.restoreFromProjectBoardItems(
        doneItems,
        inProgressItems,
        inReviewItems
      );

      this.logger.info('Workflow state initialized successfully', {
        totalProcessedTasks: this.workflowStateManager.getStats().processedTasksCount,
        totalActiveTasks: this.workflowStateManager.getStats().activeTasksCount,
        todoItemsCount: todoItems.length,
        inProgressItemsCount: inProgressItems.length,
        inReviewItemsCount: inReviewItems.length,
        doneItemsCount: doneItems.length
      });

    } catch (error) {
      this.logger.error('Failed to initialize workflow state', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      
      this.errorManager.addError('WORKFLOW_INIT_ERROR', 'Failed to initialize workflow state', { error });
      throw error; // 초기화 실패는 상위로 전파
    }
  }

  /**
   * 모든 상태의 작업 조회
   */
  private async getAllBoardItems() {
    return await Promise.all([
      this.dependencies.projectBoardService.getItems(this.config.boardId, 'TODO'),
      this.dependencies.projectBoardService.getItems(this.config.boardId, 'IN_PROGRESS'),
      this.dependencies.projectBoardService.getItems(this.config.boardId, 'IN_REVIEW'),
      this.dependencies.projectBoardService.getItems(this.config.boardId, 'DONE')
    ]);
  }

  /**
   * 워크플로우 상태 검증
   */
  async validate(): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // 프로젝트 보드 연결 확인
      const todoItems = await this.dependencies.projectBoardService.getItems(this.config.boardId, 'TODO');
      
      if (!Array.isArray(todoItems)) {
        errors.push('Project board service returned invalid data');
      }

      // StateManager 연결 확인 - Worker 상태 확인으로 대체
      const workers = await this.dependencies.stateManager.getAllWorkers();
      if (!workers) {
        warnings.push('Unable to retrieve workers from StateManager');
      }

      // Manager Communicator 연결 확인은 실제 호출 없이는 어려우므로 생략
      
    } catch (error) {
      errors.push(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    const isValid = errors.length === 0;
    
    this.logger.debug('Workflow validation completed', {
      isValid,
      errorCount: errors.length,
      warningCount: warnings.length
    });

    return {
      isValid,
      errors,
      warnings
    };
  }

  /**
   * 워크플로우 상태 리셋
   */
  async reset(): Promise<void> {
    this.logger.info('Resetting workflow state');
    
    this.workflowStateManager.initializeState();
    
    this.logger.info('Workflow state reset completed');
  }
}
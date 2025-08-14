// Task types
export * from './task.types';

// Worker types  
export * from './worker.types';

// Project board types
export * from './project-board.types';

// Pull request types
export * from './pull-request.types';


// Provider types
export * from './provider.types';

// Config types
export * from './config.types';

// Planner types
export * from './planner.types';

// Manager types
export * from './manager.types';

// Developer types
export * from './developer.types';

// System status types
export interface SystemStatus {
  readonly isRunning: boolean;
  readonly plannerStatus: any;
  readonly workerPoolStatus: any;
  readonly startedAt?: Date;
  readonly uptime?: number;
}

// Import types for ExternalServices
import type { ProjectBoardService } from './project-board.types';
import type { PullRequestService } from './pull-request.types';

// External Services for dependency injection
export interface ExternalServices {
  readonly projectBoardService?: ProjectBoardService;
  readonly pullRequestService?: PullRequestService;
  readonly gitService?: any; // GitService type
  readonly repositoryManager?: any; // RepositoryManager type
  readonly developerFactory?: any; // DeveloperFactory type
  readonly developer?: any; // Developer type for testing
}


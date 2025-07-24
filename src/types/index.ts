// Task types
export * from './task.types';

// Worker types  
export * from './worker.types';

// Project board types
export * from './project-board.types';

// Pull request types
export * from './pull-request.types';

// Repository types
export * from './repository.types';

// Provider types
export * from './provider.types';

// Config types
export * from './config.types';

// Planner types
export * from './planner.types';

// Common utility types
export type Result<T, E = Error> = {
  readonly success: true;
  readonly data: T;
} | {
  readonly success: false;
  readonly error: E;
};

export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;
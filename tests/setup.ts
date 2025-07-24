import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Global test setup
beforeAll(() => {
  // Setup global test configuration
});

afterAll(() => {
  // Cleanup after all tests
});

// Mock console methods in tests to avoid noise
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
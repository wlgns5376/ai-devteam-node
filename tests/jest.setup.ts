// Jest setup file for ESM and mock configuration
import * as fs from 'fs';
import * as path from 'path';

// Mock @octokit/rest globally for all tests
jest.mock('@octokit/rest');

// Set up global test environment
process.env.NODE_ENV = 'test';

// Clean up temp files before each test file
const cleanupTempFiles = () => {
  const tempStatePath = path.join(process.cwd(), 'temp-state');
  if (fs.existsSync(tempStatePath)) {
    fs.rmSync(tempStatePath, { recursive: true, force: true });
  }
};

// Clean up before tests
cleanupTempFiles();
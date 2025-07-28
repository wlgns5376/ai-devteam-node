// Jest setup file for ESM and mock configuration

// Mock @octokit/rest globally for all tests
jest.mock('@octokit/rest');

// Set up global test environment
process.env.NODE_ENV = 'test';
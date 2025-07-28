// Mock for @octokit/rest to handle ESM compatibility issues
export const Octokit = jest.fn().mockImplementation(() => ({
  rest: {
    repos: {
      get: jest.fn(),
      createForAuthenticatedUser: jest.fn(),
      listForAuthenticatedUser: jest.fn()
    },
    pulls: {
      get: jest.fn(),
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      merge: jest.fn(),
      listReviews: jest.fn(),
      listCommentsForRepo: jest.fn(),
      createReview: jest.fn(),
      createReviewComment: jest.fn()
    },
    issues: {
      get: jest.fn(),
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      listComments: jest.fn(),
      createComment: jest.fn(),
      listEvents: jest.fn()
    },
    projects: {
      listForRepo: jest.fn(),
      listForOrg: jest.fn(),
      listForUser: jest.fn(),
      get: jest.fn(),
      listColumns: jest.fn(),
      listCards: jest.fn(),
      getCard: jest.fn(),
      updateCard: jest.fn(),
      moveCard: jest.fn()
    }
  },
  request: jest.fn(),
  graphql: jest.fn(),
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

export default { Octokit };
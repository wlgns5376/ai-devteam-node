/**
 * Mock for @anthropic-ai/claude-agent-sdk
 */

export const query = jest.fn().mockResolvedValue({
  content: 'Mocked response from Claude SDK',
  stopReason: 'end_turn'
});

export default {
  query
};

import { describe, it, expect } from 'vitest';
import { clearHistory } from './agent.js';

// clearHistory is a side-effect function operating on internal module state.
// We test it indirectly by verifying it doesn't throw and accepts arbitrary IDs.

describe('clearHistory', () => {
  it('does not throw when clearing an unknown sender', () => {
    expect(() => clearHistory('unknown-sender')).not.toThrow();
  });

  it('does not throw when clearing the same sender twice', () => {
    expect(() => {
      clearHistory('+15555550100');
      clearHistory('+15555550100');
    }).not.toThrow();
  });

  it('accepts the special "local" sender ID', () => {
    expect(() => clearHistory('local')).not.toThrow();
  });
});

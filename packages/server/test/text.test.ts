import { describe, it, expect } from 'vitest';
import { joinWithinBudget, stripAnsi, truncateText } from '../src/utils/text.js';

const ESC = String.fromCharCode(27);

describe('text utils', () => {
  it('strips terminal color codes', () => {
    expect(stripAnsi(`${ESC}[48;2;253;247;231m${ESC}[30m${ESC}[1mNOTE: ${ESC}[22mhello${ESC}[0m`)).toBe('NOTE: hello');
  });

  it('truncates long text and says how much is hidden', () => {
    expect(truncateText('short', 10)).toBe('short');
    expect(truncateText('a'.repeat(15), 10)).toBe(`${'a'.repeat(10)}… [+5 chars]`);
  });

  it('keeps the newest blocks that fit the budget', () => {
    const { text, omitted } = joinWithinBudget(['old-1', 'old-2', 'new-1', 'new-2'], 12, '\n');
    expect(text).toBe('new-1\nnew-2');
    expect(omitted).toBe(2);
  });

  it('always keeps at least the newest block even when it exceeds the budget', () => {
    const { text, omitted } = joinWithinBudget(['a', 'b'.repeat(50)], 10);
    expect(text).toBe('b'.repeat(50));
    expect(omitted).toBe(1);
  });
});

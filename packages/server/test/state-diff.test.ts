import { describe, it, expect } from 'vitest';
import { diffStates } from '../src/utils/state-diff.js';

describe('diffStates', () => {
  it('returns empty for identical states', () => {
    const state = { a: 1, b: { c: 'x' } };
    expect(diffStates(state, state)).toEqual([]);
    expect(diffStates({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it('reports changed leaf paths', () => {
    const before = { auth: { loggedIn: false, attempts: 1 }, theme: 'light' };
    const after = { auth: { loggedIn: true, attempts: 1 }, theme: 'light' };

    const diff = diffStates(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ path: 'auth.loggedIn', kind: 'changed', before: false, after: true });
  });

  it('reports added and removed keys', () => {
    const diff = diffStates({ a: 1 }, { b: 2 });

    expect(diff).toContainEqual(expect.objectContaining({ path: 'a', kind: 'removed' }));
    expect(diff).toContainEqual(expect.objectContaining({ path: 'b', kind: 'added' }));
  });

  it('summarizes objects and arrays in before/after values', () => {
    const diff = diffStates({ list: [1, 2, 3] }, { list: [1, 2, 3, 4] });
    const entry = diff.find((e) => e.path.startsWith('list'));
    expect(entry).toBeDefined();
  });

  it('is bounded on massive diffs', () => {
    const before: Record<string, number> = {};
    const after: Record<string, number> = {};
    for (let i = 0; i < 500; i++) {
      before[`k${i}`] = i;
      after[`k${i}`] = i + 1;
    }

    const diff = diffStates(before, after);
    expect(diff.length).toBeLessThanOrEqual(100);
  });

  it('handles type changes at the root', () => {
    const diff = diffStates('string', { now: 'object' });
    expect(diff).toHaveLength(1);
    expect(diff[0].path).toBe('(root)');
  });
});

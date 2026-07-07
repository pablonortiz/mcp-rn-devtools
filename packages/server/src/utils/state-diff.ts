export interface StateDiffEntry {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

const MAX_DIFF_ENTRIES = 100;
const MAX_DEPTH = 8;

/**
 * Structural diff between two state snapshots. Returns changed leaf paths with
 * before/after values (summarized). Bounded: stops at MAX_DIFF_ENTRIES paths.
 */
export function diffStates(before: unknown, after: unknown): StateDiffEntry[] {
  const entries: StateDiffEntry[] = [];
  walk(before, after, '', entries, 0);
  return entries;
}

function walk(
  before: unknown,
  after: unknown,
  path: string,
  entries: StateDiffEntry[],
  depth: number,
): void {
  if (entries.length >= MAX_DIFF_ENTRIES) return;
  if (Object.is(before, after)) return;

  const bothObjects =
    before !== null && after !== null &&
    typeof before === 'object' && typeof after === 'object' &&
    Array.isArray(before) === Array.isArray(after);

  if (!bothObjects || depth >= MAX_DEPTH) {
    entries.push({
      path: path || '(root)',
      kind: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed',
      before: summarize(before),
      after: summarize(after),
    });
    return;
  }

  const beforeObj = before as Record<string, unknown>;
  const afterObj = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);

  for (const key of keys) {
    if (entries.length >= MAX_DIFF_ENTRIES) return;
    const childPath = path ? `${path}.${key}` : key;
    const inBefore = key in beforeObj;
    const inAfter = key in afterObj;

    if (!inBefore) {
      entries.push({ path: childPath, kind: 'added', after: summarize(afterObj[key]) });
    } else if (!inAfter) {
      entries.push({ path: childPath, kind: 'removed', before: summarize(beforeObj[key]) });
    } else {
      walk(beforeObj[key], afterObj[key], childPath, entries, depth + 1);
    }
  }
}

function summarize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string') {
    const s = value as string;
    return s.length > 200 ? `${s.slice(0, 200)}…[truncated]` : s;
  }
  if (t === 'number' || t === 'boolean') return value;
  if (Array.isArray(value)) return `[Array(${value.length})]`;
  if (t === 'object') {
    const keys = Object.keys(value as object);
    return `{${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ', …' : ''}}`;
  }
  return String(value);
}

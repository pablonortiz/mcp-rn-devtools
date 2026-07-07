/**
 * Depth-bounded summary of an arbitrary value, sized for LLM consumption.
 * Mirrors the pruning done inside the injected runtime agent so SDK-sourced
 * and agent-sourced state render consistently.
 */
export function pruneValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string') {
    const s = value as string;
    return s.length > 500 ? `${s.slice(0, 500)}…[truncated]` : s;
  }
  if (t === 'number' || t === 'boolean') return value;
  if (t === 'function') return '[Function]';
  if (t !== 'object') return String(value);

  if (depth <= 0) {
    if (Array.isArray(value)) return `[Array(${value.length})]`;
    const keys = Object.keys(value as object);
    return `{${keys.slice(0, 12).join(', ')}${keys.length > 12 ? ', …' : ''}}`;
  }

  if (Array.isArray(value)) {
    const out: unknown[] = value.slice(0, 50).map((item) => pruneValue(item, depth - 1));
    if (value.length > 50) out.push(`…+${value.length - 50} more`);
    return out;
  }

  const out: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>);
  for (const key of keys.slice(0, 100)) {
    try {
      out[key] = pruneValue((value as Record<string, unknown>)[key], depth - 1);
    } catch {
      out[key] = '[unserializable]';
    }
  }
  if (keys.length > 100) out['…'] = `+${keys.length - 100} more keys`;
  return out;
}

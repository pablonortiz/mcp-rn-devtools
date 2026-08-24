import { StyleSheet } from 'react-native';

/**
 * Props serialization for QA reports: keeps what helps a coding agent
 * (primitives, plain data, flattened styles) and drops what doesn't survive
 * JSON or would bloat the report (functions, React elements, children).
 */

const MAX_STRING_LENGTH = 200;
const MAX_DEPTH = 2;
const MAX_KEYS = 40;

export function serializeProps(props: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!props) return {};
  const out: Record<string, unknown> = {};
  let keys = 0;
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children') continue;
    if (keys >= MAX_KEYS) {
      out['…'] = '[more props omitted]';
      break;
    }
    out[key] = serializeValue(value, 0);
    keys++;
  }
  return out;
}

export function flattenStyle(style: unknown): Record<string, unknown> | null {
  if (style === null || style === undefined) return null;
  try {
    const flat = StyleSheet.flatten(style as never);
    if (!flat || typeof flat !== 'object') return null;
    return serializeValue(flat, 0) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function serializeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;

  const type = typeof value;
  if (type === 'string') {
    const str = value as string;
    return str.length > MAX_STRING_LENGTH ? `${str.slice(0, MAX_STRING_LENGTH)}…` : str;
  }
  if (type === 'number' || type === 'boolean') return value;
  if (type === 'function') return '[Function]';
  if (type !== 'object') return String(value);

  if (isReactElement(value)) return '[ReactElement]';
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? `[Array(${value.length})]` : '[Object]';

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => serializeValue(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  let keys = 0;
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (keys >= MAX_KEYS) {
      out['…'] = '[more omitted]';
      break;
    }
    out[key] = serializeValue(val, depth + 1);
    keys++;
  }
  return out;
}

function isReactElement(value: unknown): boolean {
  return typeof value === 'object' && value !== null && '$$typeof' in value;
}

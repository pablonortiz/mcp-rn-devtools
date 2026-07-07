const SENSITIVE_KEY =
  /token|password|passwd|pwd|secret|authorization|bearer|credential|api[-_]?key|access[-_]?key|private[-_]?key|session|cookie|jwt|refresh/i;
const EXACT_SENSITIVE = new Set(['auth']);
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g;

export const REDACTED = '[REDACTED]';

export function redactionEnabled(): boolean {
  return process.env.MCP_RN_NO_REDACT !== '1';
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || EXACT_SENSITIVE.has(key.toLowerCase());
}

/** Masks token-shaped substrings (JWTs, Bearer headers) inside free text. */
export function redactText(text: string): string {
  if (!redactionEnabled()) return text;
  return text.replace(JWT_PATTERN, REDACTED).replace(BEARER_PATTERN, `Bearer ${REDACTED}`);
}

/**
 * Deep-masks sensitive values in app data before it reaches the LLM:
 * values under sensitive keys are replaced entirely; token-shaped strings
 * anywhere are masked. Opt out with MCP_RN_NO_REDACT=1.
 */
export function redact<T>(value: T): T {
  if (!redactionEnabled()) return value;
  return redactValue(value, new WeakSet(), 0) as T;
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value !== 'object') return value;
  if (depth > 20) return value;
  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key) && val !== null && val !== undefined) {
      out[key] = REDACTED;
    } else {
      out[key] = redactValue(val, seen, depth + 1);
    }
  }
  return out;
}

/** Redacts a raw storage value: sensitive key → full mask; JSON values → deep mask. */
export function redactStorageValue(key: string, value: string | null): string | null {
  if (!redactionEnabled() || value === null) return value;
  if (isSensitiveKey(key)) return REDACTED;
  try {
    const parsed = JSON.parse(value);
    if (parsed !== null && typeof parsed === 'object') {
      return JSON.stringify(redact(parsed), null, 2);
    }
  } catch {
    // not JSON — fall through to text masking
  }
  return redactText(value);
}

/** Redacts HTTP headers: sensitive header names are masked, values scanned for tokens. */
export function redactHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers || !redactionEnabled()) return headers;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = isSensitiveKey(name) ? REDACTED : redactText(value);
  }
  return out;
}

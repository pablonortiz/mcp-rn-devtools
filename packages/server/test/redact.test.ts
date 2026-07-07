import { describe, it, expect, afterEach } from 'vitest';
import {
  redact,
  redactText,
  redactStorageValue,
  redactHeaders,
  isSensitiveKey,
  REDACTED,
} from '../src/utils/redact.js';

afterEach(() => {
  delete process.env.MCP_RN_NO_REDACT;
});

describe('redact', () => {
  it('masks values under sensitive keys', () => {
    const state = {
      user: { name: 'Pablo' },
      oauthTokens: { access: 'abc123', refresh: 'def456' },
      password: 'hunter2',
      apiKey: 'sk-live-xyz',
    };

    const result = redact(state);
    expect(result.user.name).toBe('Pablo');
    expect(result.oauthTokens).toBe(REDACTED);
    expect(result.password).toBe(REDACTED);
    expect(result.apiKey).toBe(REDACTED);
  });

  it('masks JWT-shaped strings anywhere in the tree', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const state = { session: { current: jwt }, plain: 'hello' };

    const result = redact(state);
    expect(result.session).toBe(REDACTED); // 'session' is itself sensitive
    expect(result.plain).toBe('hello');
    expect(JSON.stringify(redact({ innocentKey: jwt }))).not.toContain(jwt);
  });

  it('handles arrays and circular structures', () => {
    const node: Record<string, unknown> = { token: 'x', list: [1, 'two'] };
    node.self = node;

    const result = redact(node) as Record<string, unknown>;
    expect(result.token).toBe(REDACTED);
    expect(result.list).toEqual([1, 'two']);
    expect(result.self).toBe('[Circular]');
  });

  it('is a no-op when MCP_RN_NO_REDACT=1', () => {
    process.env.MCP_RN_NO_REDACT = '1';
    const state = { password: 'hunter2' };
    expect(redact(state).password).toBe('hunter2');
  });
});

describe('redactText', () => {
  it('masks Bearer tokens in free text', () => {
    const text = 'Authorization: Bearer abcdef123456789';
    expect(redactText(text)).toBe(`Authorization: Bearer ${REDACTED}`);
  });
});

describe('redactStorageValue', () => {
  it('fully masks values stored under sensitive keys', () => {
    expect(redactStorageValue('currentToken', 'raw-secret')).toBe(REDACTED);
    expect(redactStorageValue('oauthTokens', '{"a":1}')).toBe(REDACTED);
  });

  it('deep-masks JSON values under innocent keys', () => {
    const value = JSON.stringify({ theme: 'dark', accessToken: 'zzz' });
    const result = redactStorageValue('preferences', value)!;
    expect(result).toContain('dark');
    expect(result).not.toContain('zzz');
  });

  it('passes through null and plain values', () => {
    expect(redactStorageValue('foo', null)).toBeNull();
    expect(redactStorageValue('foo', 'plain text')).toBe('plain text');
  });
});

describe('redactHeaders', () => {
  it('masks sensitive header names', () => {
    const headers = { Authorization: 'Bearer abc', 'Content-Type': 'application/json' };
    const result = redactHeaders(headers)!;
    expect(result.Authorization).toBe(REDACTED);
    expect(result['Content-Type']).toBe('application/json');
  });
});

describe('isSensitiveKey', () => {
  it('matches common secret key names but not innocent ones', () => {
    for (const key of ['currentToken', 'oauthTokens', 'password', 'api_key', 'Authorization', 'refreshToken', 'auth']) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
    for (const key of ['userName', 'theme', 'items', 'network', 'author']) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });
});

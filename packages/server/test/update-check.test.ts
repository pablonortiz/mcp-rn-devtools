import { describe, it, expect } from 'vitest';
import { isNewerVersion, latestPublishedVersion } from '../src/utils/update-check.js';

describe('update check', () => {
  it('compares versions numerically', () => {
    expect(isNewerVersion('0.4.0', '0.3.1')).toBe(true);
    expect(isNewerVersion('0.3.10', '0.3.9')).toBe(true);
    expect(isNewerVersion('0.3.1', '0.3.1')).toBe(false);
    expect(isNewerVersion('0.2.9', '0.3.1')).toBe(false);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
  });

  it('reads the latest version from the registry once', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ version: '9.9.9' }))) as typeof fetch;
    expect(await latestPublishedVersion(fetchImpl)).toBe('9.9.9');
    const failing = (async () => { throw new Error('offline'); }) as typeof fetch;
    expect(await latestPublishedVersion(failing)).toBe('9.9.9');
  });
});

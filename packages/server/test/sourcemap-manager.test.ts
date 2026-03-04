import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SourceMapManager } from '../src/managers/sourcemap-manager.js';

// Minimal valid source map for testing
const MOCK_SOURCEMAP = JSON.stringify({
  version: 3,
  file: 'index.bundle',
  sources: ['src/App.tsx', 'src/hooks/useData.ts'],
  sourcesContent: [null, null],
  // This mapping maps line 1 col 0 → src/App.tsx line 1 col 0
  // and line 2 col 0 → src/hooks/useData.ts line 10 col 4
  mappings: 'AAAA;ACSK',
});

describe('SourceMapManager', () => {
  let manager: SourceMapManager;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    manager = new SourceMapManager(8081);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    manager.invalidate();
    vi.restoreAllMocks();
  });

  it('should fetch and parse source map from Metro', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => MOCK_SOURCEMAP,
    });

    const location = await manager.resolve(1, 0);
    expect(location).not.toBeNull();
    expect(location!.source).toBe('src/App.tsx');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('should cache the source map', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => MOCK_SOURCEMAP,
    });

    await manager.resolve(1, 0);
    await manager.resolve(1, 0);

    // Should only fetch once due to caching
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should return null when Metro is not reachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const location = await manager.resolve(1, 0);
    expect(location).toBeNull();
  });

  it('should try multiple hosts and paths', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await manager.resolve(1, 0);

    // Should have tried multiple combinations
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('should resolve line 2 to the second source file', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => MOCK_SOURCEMAP,
    });

    const location = await manager.resolve(2, 0);
    expect(location).not.toBeNull();
    expect(location!.source).toBe('src/hooks/useData.ts');
  });

  it('should invalidate cache', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => MOCK_SOURCEMAP,
    });

    await manager.resolve(1, 0);
    manager.invalidate();
    await manager.resolve(1, 0);

    // Should fetch twice because cache was invalidated
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('should resolve multiple locations at once', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => MOCK_SOURCEMAP,
    });

    const results = await manager.resolveMany([
      { line: 1, column: 0 },
      { line: 2, column: 0 },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]?.source).toBe('src/App.tsx');
    expect(results[1]?.source).toBe('src/hooks/useData.ts');
  });
});

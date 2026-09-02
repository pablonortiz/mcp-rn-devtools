import { SourceMapConsumer, type RawSourceMap } from 'source-map';
import { logger } from '../utils/logger.js';

export interface SourceLocation {
  source: string;
  line: number;
  column: number;
  name: string | null;
}

export class SourceMapManager {
  private consumer: SourceMapConsumer | null = null;
  private loading = false;
  private metroPort: number;
  private lastFetchTime = 0;
  private readonly CACHE_TTL_MS = 60_000; // re-fetch after 1 minute (hot reload)
  private urlConsumers = new Map<string, { consumer: SourceMapConsumer; loadedAt: number }>();

  constructor(metroPort: number) {
    this.metroPort = metroPort;
  }

  /** Follows the connection when it moves to another Metro; cached maps belong to the old one. */
  setMetroPort(metroPort: number): void {
    if (metroPort === this.metroPort) return;
    this.metroPort = metroPort;
    this.invalidate();
  }

  /**
   * Resolves a position inside a specific bundle — the URL a Hermes stack frame
   * names. Lazy bundles (RN 0.76+) have their own maps whose lines differ from
   * index.map, so the frame's own URL is the only reliable key.
   */
  async resolveAtUrl(bundleUrl: string, line: number, column: number = 0): Promise<SourceLocation | null> {
    const consumer = await this.consumerForUrl(bundleUrl);
    if (!consumer) return this.resolve(line, column);

    const pos = consumer.originalPositionFor({ line, column });
    if (!pos.source) return null;
    return { source: pos.source, line: pos.line ?? 0, column: pos.column ?? 0, name: pos.name };
  }

  /**
   * Project root inferred from the map: the directory shared by every
   * non-node_modules source. Pass the app's real bundle URL to avoid asking
   * Metro for a platform it may not be serving.
   */
  async getProjectRoot(bundleUrl?: string): Promise<string | null> {
    const cached = this.urlConsumers.values().next().value?.consumer;
    const consumer = bundleUrl ? await this.consumerForUrl(bundleUrl) : cached ?? (await this.getConsumer());
    if (!consumer) return null;
    // `sources` lives on the concrete consumers, not on the base interface the typings expose
    return commonSourceRoot((consumer as unknown as { sources?: string[] }).sources ?? []);
  }

  private async consumerForUrl(bundleUrl: string): Promise<SourceMapConsumer | null> {
    const mapUrl = this.mapUrlFor(bundleUrl);
    if (!mapUrl) return null;

    const cached = this.urlConsumers.get(mapUrl);
    if (cached && Date.now() - cached.loadedAt < this.CACHE_TTL_MS) return cached.consumer;

    try {
      const response = await fetch(mapUrl, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) return cached?.consumer ?? null;
      const map = JSON.parse(await response.text()) as RawSourceMap;
      if (!map.mappings) return cached?.consumer ?? null;

      cached?.consumer.destroy();
      const consumer = await new SourceMapConsumer(map);
      this.urlConsumers.set(mapUrl, { consumer, loadedAt: Date.now() });
      return consumer;
    } catch (e) {
      logger.debug('Failed to load source map for bundle', (e as Error).message);
      return cached?.consumer ?? null;
    }
  }

  /**
   * Bundle URL → its source map URL, via localhost (the device reaches Metro
   * through its own host: 10.0.2.2, adb reverse…). Hermes stack frames write
   * the query as `index.bundle//&platform=…`, and RN asks Metro for
   * `sourcePaths=url-server` (placeholder `/[metro-project]/` paths) — we want
   * absolute paths, so the map is requested with `sourcePaths=absolute`.
   */
  private mapUrlFor(bundleUrl: string): string | null {
    try {
      const url = new URL(bundleUrl.replace(/\.bundle\/\/&/, '.bundle?'));
      if (!url.pathname.endsWith('.bundle')) return null;
      url.hostname = 'localhost';
      url.port = String(this.metroPort);
      url.pathname = url.pathname.replace(/\.bundle$/, '.map');
      url.searchParams.set('sourcePaths', 'absolute');
      return url.toString();
    } catch {
      return null;
    }
  }

  async resolve(
    line: number,
    column: number = 0,
  ): Promise<SourceLocation | null> {
    const consumer = await this.getConsumer();
    if (!consumer) return null;

    const pos = consumer.originalPositionFor({ line, column });
    if (!pos.source) return null;

    return {
      source: pos.source,
      line: pos.line ?? 0,
      column: pos.column ?? 0,
      name: pos.name,
    };
  }

  async resolveMany(
    locations: Array<{ line: number; column?: number }>,
  ): Promise<Array<SourceLocation | null>> {
    const consumer = await this.getConsumer();
    if (!consumer) return locations.map(() => null);

    return locations.map(({ line, column }) => {
      const pos = consumer.originalPositionFor({ line, column: column ?? 0 });
      if (!pos.source) return null;
      return {
        source: pos.source,
        line: pos.line ?? 0,
        column: pos.column ?? 0,
        name: pos.name,
      };
    });
  }

  invalidate(): void {
    if (this.consumer) {
      this.consumer.destroy();
      this.consumer = null;
    }
    this.lastFetchTime = 0;
    for (const entry of this.urlConsumers.values()) entry.consumer.destroy();
    this.urlConsumers.clear();
  }

  private async getConsumer(): Promise<SourceMapConsumer | null> {
    const now = Date.now();

    // Return cached if fresh
    if (this.consumer && now - this.lastFetchTime < this.CACHE_TTL_MS) {
      return this.consumer;
    }

    // Avoid concurrent fetches
    if (this.loading) {
      // Wait for in-flight fetch
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (!this.loading) return this.consumer;
      }
      return this.consumer;
    }

    this.loading = true;
    try {
      const rawMap = await this.fetchSourceMap();
      if (!rawMap) return null;

      // Destroy old consumer
      if (this.consumer) {
        this.consumer.destroy();
      }

      this.consumer = await new SourceMapConsumer(rawMap);
      this.lastFetchTime = now;
      return this.consumer;
    } catch (e) {
      logger.warn('Failed to load source map', (e as Error).message);
      return null;
    } finally {
      this.loading = false;
    }
  }

  private async fetchSourceMap(): Promise<RawSourceMap | null> {
    // Metro serves source maps at /index.map (same as the bundle but .map)
    const hosts = ['localhost', '127.0.0.1'];
    const paths = [
      '/index.map?platform=ios&dev=true&minify=false',
      '/index.map?platform=android&dev=true&minify=false',
      '/index.map?dev=true',
    ];

    for (const host of hosts) {
      for (const path of paths) {
        const url = `http://${host}:${this.metroPort}${path}`;
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(15000), // source maps can be large
          });
          if (!response.ok) continue;

          const text = await response.text();
          const map = JSON.parse(text) as RawSourceMap;
          if (map.mappings) {
            logger.info(`Source map loaded from ${url} (${(text.length / 1024 / 1024).toFixed(1)} MB)`);
            return map;
          }
        } catch {
          continue;
        }
      }
    }

    logger.debug('Could not fetch source map from Metro');
    return null;
  }
}

/** Longest directory prefix shared by the project's own sources (absolute Metro paths). */
export function commonSourceRoot(sources: string[]): string | null {
  const own = sources.filter(
    (source) => source.startsWith('/') && !source.includes('/node_modules/') && !source.includes('__prelude__'),
  );
  if (own.length === 0) return null;

  let prefix = own[0].split('/').slice(0, -1);
  for (const source of own.slice(1)) {
    const parts = source.split('/');
    let shared = 0;
    while (shared < prefix.length && shared < parts.length && prefix[shared] === parts[shared]) shared++;
    prefix = prefix.slice(0, shared);
    if (prefix.length <= 1) return null;
  }
  return prefix.join('/') || null;
}

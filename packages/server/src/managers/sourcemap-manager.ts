import { SourceMapConsumer, type RawSourceMap } from 'source-map';
import { logger } from '../utils/logger.js';

interface SourceLocation {
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

  constructor(metroPort: number) {
    this.metroPort = metroPort;
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

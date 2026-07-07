import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Works both from dist/ (../package.json) and from src/utils/ in tests (../../package.json)
function readVersion(): string {
  for (const candidate of ['../package.json', '../../package.json']) {
    try {
      const pkg = require(candidate) as { name?: string; version?: string };
      if (pkg.name === 'mcp-rn-devtools' && pkg.version) return pkg.version;
    } catch {
      // try next
    }
  }
  return '0.0.0';
}

export const SERVER_VERSION = readVersion();

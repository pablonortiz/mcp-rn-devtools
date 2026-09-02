import { SERVER_VERSION } from './version.js';

const REGISTRY_URL = 'https://registry.npmjs.org/mcp-rn-devtools/latest';
const REGISTRY_TIMEOUT_MS = 1500;

let cached: Promise<string | null> | null = null;

/** Latest published version, fetched once per process (opt out with MCP_RN_NO_UPDATE_CHECK=1). */
export function latestPublishedVersion(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (process.env.MCP_RN_NO_UPDATE_CHECK === '1') return Promise.resolve(null);
  cached ??= fetchImpl(REGISTRY_URL, { signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) })
    .then((response) => (response.ok ? (response.json() as Promise<{ version?: string }>) : null))
    .then((body) => body?.version ?? null)
    .catch(() => null);
  return cached;
}

export function isNewerVersion(candidate: string, current: string = SERVER_VERSION): boolean {
  const candidateParts = candidate.split('.').map(Number);
  const currentParts = current.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    const a = candidateParts[index] ?? 0;
    const b = currentParts[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

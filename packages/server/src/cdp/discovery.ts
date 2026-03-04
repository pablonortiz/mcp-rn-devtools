import { DEFAULT_METRO_PORT } from '@mcp-rn-devtools/shared';
import { logger } from '../utils/logger.js';

export interface CDPTarget {
  id: string;
  title: string;
  description: string;
  type: string;
  webSocketDebuggerUrl: string;
  vm?: string;
  reactNative?: {
    capabilities?: Record<string, boolean>;
    logicalDeviceId?: string;
  };
}

export async function discoverTargets(
  metroPort: number = DEFAULT_METRO_PORT,
): Promise<CDPTarget[]> {
  const hosts = ['localhost', '127.0.0.1', '[::1]'];

  for (const host of hosts) {
    const url = `http://${host}:${metroPort}/json/list`;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) continue;
      const targets: CDPTarget[] = await response.json();
      logger.debug(`Found ${targets.length} targets from ${url}`);
      return targets;
    } catch {
      logger.debug(`Failed to connect to ${url}`);
    }
  }

  return [];
}

export function findHermesTarget(targets: CDPTarget[]): CDPTarget | null {
  const hermesTargets = targets.filter((t) => t.vm === 'Hermes');

  if (hermesTargets.length === 0) return null;

  // Prefer targets with reactNative capabilities (RN 0.76+)
  const modern = hermesTargets.find((t) => t.reactNative?.capabilities);
  if (modern) return modern;

  // Skip synthetic pages (ID ending in -1)
  const real = hermesTargets.find((t) => !t.id.endsWith('-1'));
  return real ?? hermesTargets[0];
}

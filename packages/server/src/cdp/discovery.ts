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

/** Distinguishes "Metro is down" from "Metro is up but no app registered an inspector". */
export async function probeMetro(
  metroPort: number = DEFAULT_METRO_PORT,
): Promise<{ reachable: boolean; targets: CDPTarget[] }> {
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
      return { reachable: true, targets };
    } catch {
      logger.debug(`Failed to connect to ${url}`);
    }
  }

  return { reachable: false, targets: [] };
}

export async function discoverTargets(
  metroPort: number = DEFAULT_METRO_PORT,
): Promise<CDPTarget[]> {
  return (await probeMetro(metroPort)).targets;
}

export function findReactNativeTarget(targets: CDPTarget[]): CDPTarget | null {
  // RN 0.76+ (Fusebox) no longer sets vm: 'Hermes' — the main runtime is identified
  // by reactNative.capabilities.prefersFuseboxFrontend. Secondary runtimes registered
  // by libraries (e.g. "Reanimated UI runtime") must be excluded.
  const candidates = targets.filter(
    (t) => (t.vm === 'Hermes' || t.reactNative) && !/reanimated/i.test(t.description ?? ''),
  );
  if (candidates.length === 0) return null;

  const fusebox = candidates.find((t) => t.reactNative?.capabilities?.prefersFuseboxFrontend);
  if (fusebox) return fusebox;

  const modern = candidates.find((t) => t.reactNative?.capabilities);
  if (modern) return modern;

  // Legacy targets (vm: 'Hermes'): skip synthetic pages (ID ending in -1)
  const real = candidates.find((t) => !t.id.endsWith('-1'));
  return real ?? candidates[0];
}

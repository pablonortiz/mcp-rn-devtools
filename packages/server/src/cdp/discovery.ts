import { DEFAULT_METRO_PORT } from '@mcp-rn-devtools/shared';
import { logger } from '../utils/logger.js';

export interface CDPTarget {
  id: string;
  title: string;
  description: string;
  type: string;
  webSocketDebuggerUrl: string;
  /** Application id (Android package / iOS bundle id); RN 0.73+. */
  appId?: string;
  /** Device model, OS and API level; RN 0.73+. */
  deviceName?: string;
  vm?: string;
  reactNative?: {
    capabilities?: Record<string, boolean>;
    /** Stable hash of app + device — survives relaunches and tells identical emulators apart. */
    logicalDeviceId?: string;
  };
}

export interface MetroProbe {
  reachable: boolean;
  targets: CDPTarget[];
}

/** Metro ports tried when the configured one has no app: RN picks the next free port for parallel apps. */
export const DEFAULT_SCAN_PORTS = [8081, 8082, 8083, 8084, 8085];

/** Distinguishes "Metro is down" from "Metro is up but no app registered an inspector". */
export async function probeMetro(
  metroPort: number = DEFAULT_METRO_PORT,
  timeoutMs: number = 2000,
): Promise<MetroProbe> {
  const hosts = ['localhost', '127.0.0.1', '[::1]'];

  for (const host of hosts) {
    const url = `http://${host}:${metroPort}/json/list`;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
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

/** Reachable Metros among `ports`, probed in parallel with a short timeout. */
export async function scanMetroPorts(
  ports: number[],
  timeoutMs: number = 1000,
): Promise<Array<{ port: number; targets: CDPTarget[] }>> {
  const probes = await Promise.all(
    ports.map(async (port) => ({ port, ...(await probeMetro(port, timeoutMs)) })),
  );
  return probes
    .filter((probe) => probe.reachable)
    .map(({ port, targets }) => ({ port, targets }));
}

/**
 * The app's JS runtime, as opposed to secondary runtimes libraries register
 * (Reanimated's UI runtime does not even answer Debugger.enable).
 */
export function isMainRuntimeTarget(target: CDPTarget): boolean {
  return (
    (target.vm === 'Hermes' || Boolean(target.reactNative)) &&
    !/reanimated/i.test(target.description ?? '')
  );
}

export function describeTarget(target: CDPTarget): string {
  return `${target.id}: ${target.title} (${target.description})`;
}

export function findReactNativeTarget(targets: CDPTarget[]): CDPTarget | null {
  // RN 0.76+ (Fusebox) no longer sets vm: 'Hermes' — the main runtime is identified
  // by reactNative.capabilities.prefersFuseboxFrontend.
  const candidates = targets.filter(isMainRuntimeTarget);
  if (candidates.length === 0) return null;

  const fusebox = candidates.find((t) => t.reactNative?.capabilities?.prefersFuseboxFrontend);
  if (fusebox) return fusebox;

  const modern = candidates.find((t) => t.reactNative?.capabilities);
  if (modern) return modern;

  // Legacy targets (vm: 'Hermes'): skip synthetic pages (ID ending in -1)
  const real = candidates.find((t) => !t.id.endsWith('-1'));
  return real ?? candidates[0];
}

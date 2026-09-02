import type { ErrorEntry } from '@mcp-rn-devtools/shared';
import type { ConnectionManager } from '../managers/connection-manager.js';
import type { SDKBridgeServer } from '../sdk-bridge/sdk-server.js';
import {
  describeTarget,
  isMainRuntimeTarget,
  probeMetro,
  scanMetroPorts,
  type CDPTarget,
  type MetroProbe,
} from '../cdp/discovery.js';
import { describeTargetApp } from '../cdp/target-key.js';
import { matchesSessionApp } from '../session-app.js';
import type { InstanceRecord } from '../ownership/instance-registry.js';
import type { ToolContext } from './index.js';
import { readDevServerHint, type DevServerHint } from '../utils/dev-server-hint.js';
import { isNewerVersion, latestPublishedVersion } from '../utils/update-check.js';
import { redactionEnabled } from '../utils/redact.js';
import { SERVER_VERSION } from '../utils/version.js';
import { truncateText } from '../utils/text.js';

export interface HealthProbes {
  probeMetro: (port: number) => Promise<MetroProbe>;
  scanMetroPorts: (ports: number[]) => Promise<Array<{ port: number; targets: CDPTarget[] }>>;
  readDevServerHint: () => Promise<DevServerHint | null>;
  latestVersion: () => Promise<string | null>;
}

export const defaultProbes: HealthProbes = {
  probeMetro: (port) => probeMetro(port),
  scanMetroPorts: (ports) => scanMetroPorts(ports),
  readDevServerHint: () => readDevServerHint(),
  latestVersion: () => latestPublishedVersion(),
};

const RECENT_ERROR_CHARS = 300;

/**
 * Verdict first — READY or BLOCKED with cause and fix — so the first line says
 * whether to proceed; the details follow.
 */
export async function buildHealthReport(
  cm: ConnectionManager,
  sdkBridge: SDKBridgeServer,
  probes: HealthProbes = defaultProbes,
  context?: Partial<ToolContext>,
): Promise<string> {
  const lines: string[] = [];

  if (cm.connected) {
    const target = cm.currentTarget ? `${cm.currentTarget.title} (${cm.currentTarget.id})` : 'connected';
    lines.push(`READY — ${target} on Metro :${cm.metroPort} · ${await describeAgent(cm)}`);
  } else {
    lines.push(...(await diagnoseDisconnection(cm, probes, context)));
  }

  lines.push('', ...(await statusLines(cm, sdkBridge, probes, context)), '', ...counters(cm));

  const recent = cm.errorManager.getRecentErrors(3);
  if (recent.length > 0) lines.push('', 'Recent errors:', ...recent.map(formatRecentError));

  return lines.join('\n');
}

async function describeAgent(cm: ConnectionManager): Promise<string> {
  let summary = await cm.agentBridge.summary(cm.cdp).catch(() => null);
  if (summary && summary.stores.length === 0) {
    const discovered = await cm.agentBridge.discover(cm.cdp).catch(() => null);
    if (discovered) summary = { ...summary, ...discovered };
  }
  if (!summary) return 'runtime agent not responding (re-injected by the next state tool)';

  return (
    `stores [${summary.stores.join(', ') || 'none found'}] · ` +
    `navigation ${summary.navigation ? 'yes' : 'no'} · react-query ${summary.queryClient ? 'yes' : 'no'} · ` +
    `network capture ${cm.networkManager.interceptorInstalled || cm.sdkConnected ? 'on' : 'off'}`
  );
}

async function statusLines(
  cm: ConnectionManager,
  sdkBridge: SDKBridgeServer,
  probes: HealthProbes,
  context?: Partial<ToolContext>,
): Promise<string[]> {
  const others = context?.registry?.others() ?? [];
  const lines = [
    `Version: ${SERVER_VERSION}${await updateHint(probes)}`,
    `Session app: ${sessionAppLine(context)}`,
    `Debugger owner: ${ownerLine(cm, sdkBridge)}`,
    `SDK channel :${sdkBridge.port}: ${sdkChannelLine(sdkBridge, others)}`,
    `SDK Connected: ${cm.sdkConnected ? 'Yes' : 'No'}${sdkBridge.connectedApp ? ` — app: ${sdkBridge.connectedApp}` : ''}`,
    `Redaction: ${redactionEnabled() ? 'on' : 'OFF (MCP_RN_NO_REDACT=1)'}`,
    `Uptime: ${Math.round(cm.uptime / 1000)}s`,
  ];
  if (others.length > 0) lines.push('Other instances:', ...others.map(describeInstance));
  return lines;
}

function sessionAppLine(context?: Partial<ToolContext>): string {
  const app = context?.sessionApp;
  if (!app || app.ids.length === 0) return 'none inferred — run from the app repo or set MCP_RN_APP';
  return `${app.ids.join(', ')} (${app.source})`;
}

function ownerLine(cm: ConnectionManager, sdkBridge: SDKBridgeServer): string {
  if (cm.connected && cm.currentTarget) return `this instance — ${describeTargetApp(cm.currentTarget)}`;
  if (sdkBridge.incompatibleHolder) {
    return 'an older instance holds the SDK port and does not yield — kill it: ps aux | grep mcp-rn-devtools';
  }
  return 'none yet — claimed on the next tool call';
}

function sdkChannelLine(sdkBridge: SDKBridgeServer, others: InstanceRecord[]): string {
  if (sdkBridge.holdsPort) return 'this instance';
  const holder = others.find((record) => record.sdkPort === sdkBridge.port);
  if (holder) return `${holder.label} (pid ${holder.pid})`;
  if (sdkBridge.incompatibleHolder) return 'an older instance (does not yield)';
  return sdkBridge.portConflict ? 'another process' : 'unbound';
}

function describeInstance(record: InstanceRecord): string {
  const target = record.target
    ? `${record.target.appId} @ ${record.target.deviceName || 'device'} (${record.target.state})`
    : 'idle';
  return `  ${record.label} ${record.version} pid ${record.pid} → ${target} · cwd ${record.cwd}`;
}

async function updateHint(probes: HealthProbes): Promise<string> {
  const latest = await probes.latestVersion();
  if (!latest || !isNewerVersion(latest)) return '';
  return ` (update available: ${latest} — restart the MCP server so npx picks it up)`;
}

function counters(cm: ConnectionManager): string[] {
  return [
    `Errors: ${cm.errorManager.errorsCount}`,
    `Warnings: ${cm.errorManager.warningsCount}`,
    `Network Requests: ${cm.networkManager.totalCount} total, ${cm.networkManager.failedCount} failed`,
    `Actions recorded: ${cm.actionManager.count}`,
  ];
}

function formatRecentError(error: ErrorEntry): string {
  return `  [${new Date(error.timestamp).toISOString()}] ${truncateText(error.message, RECENT_ERROR_CHARS)}`;
}

async function diagnoseDisconnection(
  cm: ConnectionManager,
  probes: HealthProbes,
  context?: Partial<ToolContext>,
): Promise<string[]> {
  const { reachable, targets } = await probes.probeMetro(cm.metroPort);
  const sessionIds = context?.sessionApp?.ids ?? [];
  if (sessionIds.length > 0 && reachable) {
    const usable = targets.filter(isMainRuntimeTarget);
    const elsewhere = await appsOnOtherMetros(cm, probes);
    const everywhere = [...usable.map((target) => `  :${cm.metroPort} ${describeTarget(target)}`), ...elsewhere];
    const matching = usable.some((target) => matchesSessionApp(target.appId ?? target.title, sessionIds));
    if (!matching && everywhere.length > 0 && !elsewhere.some((line) => sessionIds.some((id) => line.includes(id)))) {
      return [
        `BLOCKED: this session's app (${sessionIds.join(', ')}) is not registered on any Metro → launch it (debug build, Metro running); other apps found:`,
        ...everywhere,
      ];
    }
  }

  if (!reachable) {
    const elsewhere = await appsOnOtherMetros(cm, probes);
    if (elsewhere.length > 0) {
      return [
        `BLOCKED: Metro is not on :${cm.metroPort}, but another Metro has an app → select_target with metro_port, or restart with METRO_PORT=<port>`,
        ...elsewhere,
      ];
    }
    return [`BLOCKED: Metro is NOT running on port ${cm.metroPort} → start it from the app repo ("npx react-native start")`];
  }

  const usable = targets.filter(isMainRuntimeTarget);
  if (usable.length === 0) {
    const elsewhere = await appsOnOtherMetros(cm, probes);
    if (elsewhere.length > 0) {
      return [
        `BLOCKED: no app on Metro :${cm.metroPort}, but another Metro has one → select_target with metro_port, or restart with METRO_PORT=<port>`,
        ...elsewhere,
      ];
    }

    const hint = await probes.readDevServerHint();
    if (hint && hint.port !== cm.metroPort) {
      return [
        `BLOCKED: the app points at ${hint.host}:${hint.port} (Dev menu › Change Bundle Location) while this server watches :${cm.metroPort} → set the bundle location to 10.0.2.2:${cm.metroPort}, or restart with METRO_PORT=${hint.port}`,
        `  logcat: ${truncateText(hint.line, 200)}`,
      ];
    }

    return [
      'BLOCKED: Metro is running but no app registered a debug target → launch the app; if it is running, rebuild and reinstall it ("npx react-native run-android")',
      '  Old or CI-built debug APKs never register the inspector; targets also appear a few seconds after launch — retry.',
    ];
  }

  return [
    `BLOCKED: ${usable.length} target(s) available but not attached yet → retry in a few seconds, or pick one with select_target`,
    ...usable.map((target) => `  - ${describeTarget(target)}`),
  ];
}

async function appsOnOtherMetros(cm: ConnectionManager, probes: HealthProbes): Promise<string[]> {
  const otherPorts = cm.scanPorts.filter((port) => port !== cm.metroPort);
  if (otherPorts.length === 0) return [];
  const metros = await probes.scanMetroPorts(otherPorts);
  return metros.flatMap((metro) =>
    metro.targets.filter(isMainRuntimeTarget).map((target) => `  :${metro.port} ${describeTarget(target)}`),
  );
}

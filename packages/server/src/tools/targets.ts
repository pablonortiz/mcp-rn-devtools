import { z } from 'zod';
import type { ToolRegistrar } from './registrar.js';
import type { ConnectionManager, ResolvedTarget } from '../managers/connection-manager.js';
import type { ConnectionOwnership } from '../ownership.js';
import type { ToolContext } from './index.js';
import { discoverTargets, isMainRuntimeTarget, probeMetro, scanMetroPorts, type CDPTarget } from '../cdp/discovery.js';
import { describeTargetApp, targetKey } from '../cdp/target-key.js';

export function registerTargetTools(
  server: ToolRegistrar,
  cm: ConnectionManager,
  ownership: ConnectionOwnership,
  context: ToolContext,
): void {
  server.tool(
    'list_targets',
    'List debuggable React Native targets on every Metro port (8081–8085), with who holds each one: → this instance, ⊙ another rn-devtools/tapfix instance, ✗ a library runtime that cannot be selected.',
    {},
    { readOnlyHint: true },
    async () => {
      const lines: string[] = [];
      const { ids, source } = context.sessionApp;
      if (ids.length > 0) lines.push(`Session app: ${ids.join(', ')} (${source})`, '');

      const { reachable, targets } = await probeMetro(cm.metroPort);
      if (!reachable) lines.push(`Metro is not reachable on port ${cm.metroPort}.`);
      else if (targets.length === 0) lines.push(`Metro :${cm.metroPort} is running but no app has registered a debug target.`);
      else lines.push(`Metro :${cm.metroPort}:`, ...targets.map((target) => describeLine(target, cm, context)));

      const otherPorts = cm.scanPorts.filter((port) => port !== cm.metroPort);
      const metros = (await scanMetroPorts(otherPorts)).filter((metro) => metro.targets.length > 0);
      for (const metro of metros) {
        lines.push('', `Metro :${metro.port}:`, ...metro.targets.map((target) => describeLine(target, cm, context)));
      }

      if (!reachable || targets.length === 0) {
        lines.push('', metros.length > 0
          ? 'Connect to one of them with select_target(target_id, metro_port) or select_target(app).'
          : 'Launch (or reload) the app on a device/emulator.');
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'select_target',
    'Attach to a specific target and pin it for reconnects: by target_id (from list_targets, optionally with metro_port) or by app id prefix (e.g. "in.janis.wms"), searched across Metro ports. Takes the debugger from any other instance holding that target.',
    {
      target_id: z.string().optional().describe('Target ID from list_targets'),
      metro_port: z
        .number()
        .int()
        .optional()
        .describe('Metro port the target is registered on (default: the current one)'),
      app: z.string().optional().describe('Application id (or prefix) to attach to, e.g. "in.janis.wms"'),
    },
    async ({ target_id, metro_port, app }) => {
      try {
        const resolved = await resolveSelection(cm, { target_id, metro_port, app });
        await ownership.claimTarget(resolved);
        const target = await cm.connectToTarget(resolved.target.id, resolved.metroPort);
        return {
          content: [
            {
              type: 'text',
              text: `Connected to ${describeTargetApp(target)} (${target.id}) on Metro :${cm.metroPort}. This target is pinned for future reconnects.`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: (e as Error).message }],
          isError: true,
        };
      }
    },
  );
}

async function resolveSelection(
  cm: ConnectionManager,
  selection: { target_id?: string; metro_port?: number; app?: string },
): Promise<ResolvedTarget> {
  if (selection.app) {
    const found = await cm.findTargetsForApp([selection.app]);
    if (found.length === 0) throw new Error(`No running app matches "${selection.app}" on Metro ports ${[cm.metroPort, ...cm.scanPorts].filter((p, i, a) => a.indexOf(p) === i).join(', ')}. Run list_targets to see what is registered.`);
    return found[0];
  }
  if (!selection.target_id) throw new Error('Pass target_id (from list_targets) or app (an application id prefix).');

  const metroPort = selection.metro_port ?? cm.metroPort;
  const targets = await discoverTargets(metroPort);
  const target = targets.find((t) => t.id === selection.target_id);
  if (!target) {
    const available = targets.map((t) => `${t.id}: ${describeTargetApp(t)}`).join(', ') || 'none';
    throw new Error(`Target "${selection.target_id}" not found on Metro :${metroPort}. Available: ${available}`);
  }
  if (!isMainRuntimeTarget(target)) {
    const usable = targets.filter(isMainRuntimeTarget).map((t) => `${t.id}: ${describeTargetApp(t)}`).join(', ') || 'none';
    throw new Error(
      `Target "${selection.target_id}" (${target.description}) is not the app's JS runtime — ` +
        `it belongs to a library (e.g. Reanimated's UI runtime) and would hang. Use: ${usable}`,
    );
  }
  return { target, metroPort, via: 'pinned' };
}

function describeLine(target: CDPTarget, cm: ConnectionManager, context: ToolContext): string {
  const marker = holderMarker(target, cm, context);
  return `${marker} ${target.id}\n    ${describeTargetApp(target)}\n    ${target.description}`;
}

function holderMarker(target: CDPTarget, cm: ConnectionManager, context: ToolContext): string {
  if (!isMainRuntimeTarget(target)) return '✗';
  if (cm.connected && cm.currentTarget?.id === target.id) return '→';
  const holder = context.registry.holderOf(targetKey(target));
  return holder ? `⊙ [${holder.label} pid ${holder.pid}]` : ' ';
}

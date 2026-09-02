import { z } from 'zod';
import type { ToolRegistrar } from './registrar.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import type { ConnectionOwnership } from '../ownership.js';
import { isMainRuntimeTarget, probeMetro, scanMetroPorts, type CDPTarget } from '../cdp/discovery.js';

export function registerTargetTools(
  server: ToolRegistrar,
  cm: ConnectionManager,
  ownership: ConnectionOwnership,
): void {
  server.tool(
    'list_targets',
    'List debuggable React Native targets registered with Metro (multiple devices/apps can be connected), plus apps found on other Metro ports. Shows which one the server is using.',
    {},
    { readOnlyHint: true },
    async () => {
      const { reachable, targets } = await probeMetro(cm.metroPort);
      const lines: string[] = [];

      if (!reachable) {
        lines.push(`Metro is not reachable on port ${cm.metroPort}.`);
      } else if (targets.length === 0) {
        lines.push(`Metro :${cm.metroPort} is running but no app has registered a debug target.`);
      } else {
        lines.push(
          `${targets.length} target(s) on Metro :${cm.metroPort} (→ = connected, ✗ = library runtime, not selectable):`,
          '',
          ...targets.map((target) => describeLine(target, cm.currentTarget?.id)),
        );
      }

      if (!reachable || targets.length === 0) {
        lines.push('', ...(await otherMetroLines(cm)));
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'select_target',
    'Connect to a specific debug target by ID (from list_targets) and pin it for reconnects. Use when multiple devices or apps are connected to Metro, or when the app runs on another Metro port.',
    {
      target_id: z.string().describe('Target ID from list_targets'),
      metro_port: z
        .number()
        .int()
        .optional()
        .describe('Metro port the target is registered on (default: the current one)'),
    },
    async ({ target_id, metro_port }) => {
      try {
        await ownership.ensure({ connect: false });
        const target = await cm.connectToTarget(target_id, metro_port);
        return {
          content: [
            {
              type: 'text',
              text: `Connected to ${target.title} (${target.id}) on Metro :${cm.metroPort}. This target is pinned for future reconnects.`,
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

function describeLine(target: CDPTarget, currentId?: string): string {
  const marker = target.id === currentId ? '→' : isMainRuntimeTarget(target) ? ' ' : '✗';
  return `${marker} ${target.id}\n    ${target.title}\n    ${target.description}`;
}

async function otherMetroLines(cm: ConnectionManager): Promise<string[]> {
  const otherPorts = cm.scanPorts.filter((port) => port !== cm.metroPort);
  const metros = (await scanMetroPorts(otherPorts)).filter((metro) => metro.targets.length > 0);
  if (metros.length === 0) return ['Launch (or reload) the app on a device/emulator.'];

  return [
    'Apps registered on other Metro ports:',
    ...metros.flatMap((metro) =>
      metro.targets.map((target) => `  :${metro.port} ${describeLine(target).trimStart()}`),
    ),
    '',
    'Connect to one of them with select_target(target_id, metro_port).',
  ];
}

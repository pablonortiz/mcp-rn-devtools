import { z } from 'zod';
import type { ToolRegistrar } from './registrar.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

const BUFFERS = ['logs', 'errors', 'network', 'actions', 'state', 'renders'] as const;

export function registerClearBuffers(server: ToolRegistrar, cm: ConnectionManager): void {
  server.tool(
    'clear_buffers',
    'Clear captured data buffers (logs, errors, network, actions, state, renders). Call before reproducing a bug so subsequent reads contain only fresh data.',
    {
      buffers: z
        .array(z.enum(BUFFERS))
        .optional()
        .describe('Buffers to clear (omit to clear all)'),
    },
    async ({ buffers }) => {
      const targets = buffers && buffers.length > 0 ? buffers : [...BUFFERS];

      for (const buffer of targets) {
        switch (buffer) {
          case 'logs':
            cm.logManager.clear();
            break;
          case 'errors':
            cm.errorManager.clear();
            break;
          case 'network':
            cm.networkManager.clear();
            break;
          case 'actions':
            cm.actionManager.clear();
            break;
          case 'state':
            cm.stateManager.clear();
            break;
          case 'renders':
            cm.renderManager.clear();
            break;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Cleared: ${targets.join(', ')}. Reproduce the scenario now — new reads will only contain fresh data.`,
          },
        ],
      };
    },
  );
}

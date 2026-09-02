import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../utils/logger.js';

/** The slice of McpServer tools need, so registration can be wrapped without exposing the whole server. */
export type ToolRegistrar = Pick<McpServer, 'tool'>;

/**
 * Runs `beforeCall` ahead of every tool handler registered through it — how the
 * debugger gets claimed on first use instead of at startup.
 */
export function activatingRegistrar(
  server: McpServer,
  beforeCall: (toolName: string) => Promise<void>,
  except: Iterable<string> = [],
): ToolRegistrar {
  const skipped = new Set(except);
  const tool = (...args: unknown[]) => {
    const name = args[0] as string;
    const last = args.length - 1;
    const handler = args[last];
    if (typeof handler === 'function' && !skipped.has(name)) {
      args[last] = async (...handlerArgs: unknown[]) => {
        await beforeCall(name).catch((e) => logger.debug(`activation before ${name} failed`, (e as Error).message));
        return (handler as (...a: unknown[]) => unknown)(...handlerArgs);
      };
    }
    return Reflect.apply(server.tool as (...a: unknown[]) => unknown, server, args);
  };
  return { tool: tool as McpServer['tool'] };
}

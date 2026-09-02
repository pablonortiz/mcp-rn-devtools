import { describe, it, expect, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { activatingRegistrar } from '../src/tools/registrar.js';

function fakeServer() {
  const registered = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const server = {
    tool(...args: unknown[]) {
      registered.set(args[0] as string, args[args.length - 1] as (...a: unknown[]) => Promise<unknown>);
    },
  } as unknown as McpServer;
  return { server, registered };
}

describe('activatingRegistrar', () => {
  it('runs beforeCall ahead of the handler, with the tool name', async () => {
    const { server, registered } = fakeServer();
    const calls: string[] = [];
    const registrar = activatingRegistrar(server, async (name) => { calls.push(`before:${name}`); }, []);

    registrar.tool('get_errors', 'desc', {}, async () => { calls.push('handler'); return 'ok'; });
    expect(await registered.get('get_errors')!({})).toBe('ok');

    expect(calls).toEqual(['before:get_errors', 'handler']);
  });

  it('leaves excepted tools untouched', async () => {
    const { server, registered } = fakeServer();
    const beforeCall = vi.fn(async () => undefined);
    const registrar = activatingRegistrar(server, beforeCall, ['list_targets']);

    registrar.tool('list_targets', 'desc', {}, async () => 'listed');
    await registered.get('list_targets')!({});

    expect(beforeCall).not.toHaveBeenCalled();
  });

  it('still runs the handler when activation fails', async () => {
    const { server, registered } = fakeServer();
    const registrar = activatingRegistrar(server, async () => { throw new Error('no port'); }, []);

    registrar.tool('get_app_state', 'desc', {}, async () => 'state');
    expect(await registered.get('get_app_state')!({})).toBe('state');
  });
});

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createServer, type ServerOptions } from '../../src/server.js';

export type Stack = ReturnType<typeof createServer>;

/** A shared registry dir plus fully wired server stacks (lazy, ephemeral SDK port unless given). */
export function createStackFactory() {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'rn-devtools-registry-'));
  const stacks: Stack[] = [];

  async function make(options: ServerOptions & { sdkPort: number }): Promise<Stack> {
    const stack = createServer({ connectMode: 'lazy', stateDir, scanPorts: [], ...options });
    stacks.push(stack);
    await stack.start();
    return stack;
  }

  function cleanup(): void {
    for (const stack of stacks.splice(0)) stack.shutdown();
    rmSync(stateDir, { recursive: true, force: true });
  }

  return { stateDir, make, cleanup };
}

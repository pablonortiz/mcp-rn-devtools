import { describe, it, expect, afterEach } from 'vitest';
import { ControlServer, requestYield } from '../src/ownership/control-server.js';
import { freePort } from './helpers/fake-rn.js';

describe('control endpoint', () => {
  const servers: ControlServer[] = [];

  afterEach(() => {
    for (const server of servers.splice(0)) server.stop();
  });

  it("answers yield requests with the holder's decision", async () => {
    const yielded: string[] = [];
    const server = new ControlServer({
      onYield: (key, from) => {
        yielded.push(`${key}<-${from}`);
        return key === 'mine' ? 'yielded' : 'declined';
      },
      onStatus: () => ({ ok: true }),
    });
    servers.push(server);
    const port = await server.start();

    expect(await requestYield(port, 'mine', 'other')).toBe('yielded');
    expect(await requestYield(port, 'theirs', 'other')).toBe('declined');
    expect(yielded).toEqual(['mine<-other', 'theirs<-other']);
  });

  it('reports an unresponsive holder when nothing listens', async () => {
    const port = await freePort();
    expect(await requestYield(port, 'mine', 'other', 300)).toBe('unresponsive');
  });
});

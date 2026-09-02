import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { InstanceRegistry } from '../src/ownership/instance-registry.js';

const self = (instanceId: string, pid = process.pid) => ({ instanceId, pid, label: 'test', version: '0.0.0', cwd: '/tmp' });

describe('InstanceRegistry', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'rn-registry-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists the other live instances and who holds which target', () => {
    const a = new InstanceRegistry(self('a'), { dir });
    const b = new InstanceRegistry(self('b'), { dir });
    a.update({ controlPort: 1111, target: { key: 'X', appId: 'com.x', deviceName: 'd', metroPort: 8081, targetId: 't', state: 'connected' } });
    b.update({ controlPort: 2222, sdkPort: 8098 });

    expect(a.others().map((record) => record.instanceId)).toEqual(['b']);
    expect(b.holderOf('X')?.instanceId).toBe('a');
    expect(a.holderOf('X')).toBeNull();
    expect(a.sdkPortHolder(8098)?.instanceId).toBe('b');
  });

  it('prunes records of dead processes', () => {
    const dead = new InstanceRegistry(self('dead', 999_999), { dir, isAlive: () => true });
    dead.update({ controlPort: 1 });
    const live = new InstanceRegistry(self('live'), { dir, isAlive: (pid) => pid === process.pid });

    expect(live.others()).toEqual([]);
    expect(live.others()).toEqual([]);
  });

  it('ignores corrupt files', () => {
    writeFileSync(path.join(dir, 'junk.json'), '{not json');
    const a = new InstanceRegistry(self('a'), { dir });
    expect(a.others()).toEqual([]);
  });

  it('removes its own record on shutdown and stays removed', () => {
    const a = new InstanceRegistry(self('a'), { dir });
    const b = new InstanceRegistry(self('b'), { dir });
    a.update({ controlPort: 1 });
    a.remove();
    a.update({ target: null });
    expect(b.others()).toEqual([]);
  });

  it('degrades gracefully when the state dir cannot be created', () => {
    const file = path.join(dir, 'not-a-dir');
    writeFileSync(file, 'x');
    const a = new InstanceRegistry(self('a'), { dir: path.join(file, 'child') });
    expect(a.enabled).toBe(false);
    a.update({ controlPort: 1 });
    expect(a.others()).toEqual([]);
  });
});

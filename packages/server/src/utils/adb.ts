import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);
const ADB_TIMEOUT_MS = 5000;

export function findAdb(): string {
  const candidates = [
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb'),
    process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb'),
    path.join(homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return 'adb'; // last resort: rely on PATH; execFile will fail gracefully
}

export async function firstDevice(adb: string): Promise<string | null> {
  const { stdout } = await execFileAsync(adb, ['devices'], { timeout: ADB_TIMEOUT_MS });
  const line = stdout
    .split('\n')
    .slice(1)
    .find((row) => row.trim().endsWith('device'));
  return line ? line.split('\t')[0].trim() : null;
}

/**
 * Reverse-forwards the given ports on every connected device (idempotent).
 * Physical devices over USB reach Metro and the SDK bridge via localhost this
 * way — no manual `adb reverse` to forget.
 */
export async function reversePortsOnAllDevices(ports: number[]): Promise<void> {
  const adb = findAdb();
  try {
    const { stdout } = await execFileAsync(adb, ['devices'], { timeout: ADB_TIMEOUT_MS });
    const devices = stdout
      .split('\n')
      .slice(1)
      .filter((row) => row.trim().endsWith('device'))
      .map((row) => row.split('\t')[0].trim());

    for (const device of devices) {
      for (const port of ports) {
        await execFileAsync(adb, ['-s', device, 'reverse', `tcp:${port}`, `tcp:${port}`], {
          timeout: ADB_TIMEOUT_MS,
        }).catch(() => null);
      }
    }
  } catch {
    // adb unavailable — nothing to forward
  }
}

const MAX_PNG_BYTES = 20 * 1024 * 1024;

/** Captures the first device's screen as a PNG buffer (null when unavailable). */
export async function captureScreenPng(): Promise<Buffer | null> {
  const adb = findAdb();
  try {
    const device = await firstDevice(adb);
    if (!device) return null;
    const { stdout } = await execFileAsync(adb, ['-s', device, 'exec-out', 'screencap', '-p'], {
      encoding: 'buffer',
      maxBuffer: MAX_PNG_BYTES,
      timeout: ADB_TIMEOUT_MS,
    });
    return stdout && stdout.length > 0 ? (stdout as unknown as Buffer) : null;
  } catch {
    return null;
  }
}

export interface DeviceScreenInfo {
  widthPx: number;
  heightPx: number;
  density: number;
}

/** Screen size and density of the first device (for px↔dp mapping). */
export async function getDeviceScreenInfo(): Promise<DeviceScreenInfo | null> {
  const adb = findAdb();
  try {
    const device = await firstDevice(adb);
    if (!device) return null;
    const size = (await execFileAsync(adb, ['-s', device, 'shell', 'wm', 'size'], { timeout: ADB_TIMEOUT_MS })).stdout;
    const density = (await execFileAsync(adb, ['-s', device, 'shell', 'wm', 'density'], { timeout: ADB_TIMEOUT_MS })).stdout;

    // Override lines (when present) come after Physical and win
    const sizeMatch = lastMatch(size, /(?:Override|Physical) size:\s*(\d+)x(\d+)/g);
    const densityMatch = lastMatch(density, /(?:Override|Physical) density:\s*(\d+)/g);
    if (!sizeMatch || !densityMatch) return null;

    return {
      widthPx: parseInt(sizeMatch[1], 10),
      heightPx: parseInt(sizeMatch[2], 10),
      density: parseInt(densityMatch[1], 10),
    };
  } catch {
    return null;
  }
}

function lastMatch(text: string, pattern: RegExp): RegExpExecArray | null {
  let match: RegExpExecArray | null = null;
  let current: RegExpExecArray | null;
  while ((current = pattern.exec(text)) !== null) match = current;
  return match;
}

/** Force-stops and relaunches an app by package id — a reliable full JS reload. */
export async function relaunchApp(packageId: string): Promise<boolean> {
  const adb = findAdb();
  try {
    const device = await firstDevice(adb);
    if (!device) return false;

    await execFileAsync(adb, ['-s', device, 'shell', 'am', 'force-stop', packageId], {
      timeout: ADB_TIMEOUT_MS,
    });
    await execFileAsync(
      adb,
      ['-s', device, 'shell', 'monkey', '-p', packageId, '-c', 'android.intent.category.LAUNCHER', '1'],
      { timeout: ADB_TIMEOUT_MS },
    );
    return true;
  } catch {
    return false;
  }
}

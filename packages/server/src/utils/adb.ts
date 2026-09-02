import { execFile, spawn } from 'child_process';
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

export async function firstDevice(): Promise<string | null> {
  const devices = await listDevices();
  return devices[0]?.id ?? null;
}

export interface AdbDevice {
  id: string;
  model: string | null;
}

/** Connected devices (state "device") with their model names. */
export async function listDevices(): Promise<AdbDevice[]> {
  const adb = findAdb();
  try {
    const { stdout } = await execFileAsync(adb, ['devices', '-l'], { timeout: ADB_TIMEOUT_MS });
    return stdout
      .split('\n')
      .slice(1)
      .filter((row) => /\sdevice(\s|$)/.test(row.trim()))
      .map((row) => ({
        id: row.split(/\s+/)[0].trim(),
        model: row.match(/model:(\S+)/)?.[1]?.replace(/_/g, ' ') ?? null,
      }))
      .filter((device) => device.id.length > 0);
  } catch {
    return [];
  }
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
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Captures the first device's screen as a PNG buffer (null when unavailable). */
export async function captureScreenPng(preferredDevice?: string): Promise<Buffer | null> {
  const adb = findAdb();
  try {
    const device = preferredDevice ?? (await firstDevice());
    if (!device) return null;
    const { stdout } = await execFileAsync(adb, ['-s', device, 'exec-out', 'screencap', '-p'], {
      encoding: 'buffer',
      maxBuffer: MAX_PNG_BYTES,
      timeout: ADB_TIMEOUT_MS,
    });
    if (!stdout || stdout.length === 0) return null;

    // Some devices (Samsung multi-display) print a text warning before the
    // PNG bytes — cut from the PNG signature onward.
    const raw = stdout as unknown as Buffer;
    const start = raw.indexOf(PNG_SIGNATURE);
    if (start < 0) return null;
    return start === 0 ? raw : raw.subarray(start);
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
export async function getDeviceScreenInfo(preferredDevice?: string): Promise<DeviceScreenInfo | null> {
  const adb = findAdb();
  try {
    const device = preferredDevice ?? (await firstDevice());
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
export async function relaunchApp(packageId: string, preferredDevice?: string): Promise<boolean> {
  const adb = findAdb();
  try {
    const device = preferredDevice ?? (await firstDevice());
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

export interface ScreenRecording {
  /** Stops the on-device recording and returns the mp4 (null if nothing was captured). */
  stop(): Promise<Buffer | null>;
}

const MAX_RECORD_SECONDS = 180; // screenrecord's own hard limit
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/**
 * Starts `screenrecord` on the device. Stopping sends SIGINT to the remote
 * process (so the mp4 gets finalized — killing the local adb client would not)
 * and pulls the file back.
 */
export async function startScreenRecord(preferredDevice?: string): Promise<ScreenRecording | null> {
  const adb = findAdb();
  const device = preferredDevice ?? (await firstDevice());
  if (!device) return null;

  const remotePath = `/sdcard/tapfix-rec-${Date.now()}.mp4`;
  const child = spawn(adb, ['-s', device, 'shell', 'screenrecord', '--time-limit', String(MAX_RECORD_SECONDS), remotePath], {
    stdio: 'ignore',
  });
  const exited = new Promise<void>((resolve) => child.on('close', () => resolve()));
  let stopped = false;

  return {
    async stop() {
      if (stopped) return null;
      stopped = true;
      await execFileAsync(adb, ['-s', device, 'shell', 'pkill', '-INT', 'screenrecord'], { timeout: ADB_TIMEOUT_MS }).catch(() => null);
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 4000))]);
      child.kill();
      await new Promise((resolve) => setTimeout(resolve, 500)); // let the muxer flush
      try {
        const { stdout } = await execFileAsync(adb, ['-s', device, 'exec-out', 'cat', remotePath], {
          encoding: 'buffer',
          maxBuffer: MAX_VIDEO_BYTES,
          timeout: 30_000,
        });
        const video = stdout as unknown as Buffer;
        return video.length > 0 ? video : null;
      } catch {
        return null;
      } finally {
        void execFileAsync(adb, ['-s', device, 'shell', 'rm', '-f', remotePath], { timeout: ADB_TIMEOUT_MS }).catch(() => null);
      }
    },
  };
}

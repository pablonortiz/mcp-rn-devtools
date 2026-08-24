import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);
const SCREENCAP_TIMEOUT_MS = 5000;
const MAX_PNG_BYTES = 20 * 1024 * 1024;

/**
 * Best-effort device screenshot over adb (Android only). Returns true when
 * the PNG landed at outPath; false when adb or a device is unavailable.
 */
export async function captureAdbScreenshot(outPath: string): Promise<boolean> {
  const adb = findAdb();
  if (!adb) return false;

  try {
    const device = await firstDevice(adb);
    if (!device) return false;

    const { stdout } = await execFileAsync(adb, ['-s', device, 'exec-out', 'screencap', '-p'], {
      encoding: 'buffer',
      maxBuffer: MAX_PNG_BYTES,
      timeout: SCREENCAP_TIMEOUT_MS,
    });
    if (!stdout || stdout.length === 0) return false;

    await writeFile(outPath, stdout);
    return true;
  } catch (e) {
    logger.debug('adb screenshot failed', (e as Error).message);
    return false;
  }
}

function findAdb(): string | null {
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

async function firstDevice(adb: string): Promise<string | null> {
  const { stdout } = await execFileAsync(adb, ['devices'], {
    timeout: SCREENCAP_TIMEOUT_MS,
  });
  const line = stdout
    .split('\n')
    .slice(1)
    .find((row) => row.trim().endsWith('device'));
  return line ? line.split('\t')[0].trim() : null;
}

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile } from 'fs/promises';
import { findAdb, firstDevice } from './adb.js';
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

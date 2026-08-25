import { writeFile } from 'fs/promises';
import { captureScreenPng } from './adb.js';
import { logger } from './logger.js';

/**
 * Best-effort device screenshot over adb (Android only). Returns true when
 * the PNG landed at outPath; false when adb or a device is unavailable.
 */
export async function captureAdbScreenshot(outPath: string): Promise<boolean> {
  try {
    const png = await captureScreenPng();
    if (!png) return false;

    await writeFile(outPath, png);
    return true;
  } catch (e) {
    logger.debug('adb screenshot failed', (e as Error).message);
    return false;
  }
}

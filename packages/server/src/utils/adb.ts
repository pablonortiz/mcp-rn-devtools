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

import { execFile } from 'child_process';
import { promisify } from 'util';
import { findAdb, firstDevice } from './adb.js';

const execFileAsync = promisify(execFile);
const LOGCAT_LINES = 600;
const LOGCAT_MAX_BYTES = 8 * 1024 * 1024;
const LOGCAT_TIMEOUT_MS = 5000;

export interface DevServerHint {
  host: string;
  port: number;
  line: string;
}

// Where RN says it tried to reach Metro: "Failed to connect to /10.0.2.2:8083",
// "Could not connect to development server … URL: http://10.0.2.2:8082/index.bundle…"
const HINT_PATTERNS = [
  /Failed to connect to \/?([\w.-]+):(\d{2,5})/g,
  /URL:\s*(?:https?:\/\/)?([\w.-]+):(\d{2,5})/g,
  /Cannot connect to Metro[^\n]*?(?:https?:\/\/)?([\w.-]+):(\d{2,5})/g,
];

/** The dev-server host:port the app is actually pointing at, from the most recent matching logcat line. */
export function parseDevServerHint(logcat: string): DevServerHint | null {
  let best: { index: number; hint: DevServerHint } | null = null;
  for (const pattern of HINT_PATTERNS) {
    for (const match of logcat.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (best && index <= best.index) continue;
      best = { index, hint: { host: match[1], port: Number(match[2]), line: lineAt(logcat, index) } };
    }
  }
  return best?.hint ?? null;
}

function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? undefined : end).trim();
}

export async function readDevServerHint(preferredDevice?: string): Promise<DevServerHint | null> {
  try {
    const device = preferredDevice ?? (await firstDevice());
    if (!device) return null;
    const { stdout } = await execFileAsync(
      findAdb(),
      ['-s', device, 'logcat', '-d', '-t', String(LOGCAT_LINES)],
      { maxBuffer: LOGCAT_MAX_BYTES, timeout: LOGCAT_TIMEOUT_MS },
    );
    return parseDevServerHint(stdout);
  } catch {
    return null;
  }
}

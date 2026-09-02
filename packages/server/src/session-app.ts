import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';

export interface SessionApp {
  /** Application id prefixes this session belongs to (flavors add a suffix: in.janis.picking → in.janis.picking.beta). */
  ids: string[];
  /** Where the ids came from, for the health report. */
  source: string | null;
}

const GRADLE_FILES = ['android/app/build.gradle', 'android/app/build.gradle.kts'];
const GRADLE_ID = /\b(?:applicationId|namespace)\s*(?:=|\()?\s*["']([\w.]+)["']/g;
const PBXPROJ_ID = /PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([^";\n]+?)"?\s*;/g;

/**
 * The app a session is working on, read from the repo it runs in (the MCP
 * server inherits Claude Code's cwd). MCP_RN_APP overrides. Expo's app.json
 * is the last resort: RN CLI templates leave a stale package there.
 */
export function detectSessionApp(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): SessionApp {
  const explicit = env.MCP_RN_APP?.split(',').map((id) => id.trim()).filter(Boolean) ?? [];
  if (explicit.length > 0) return { ids: explicit, source: 'MCP_RN_APP' };

  for (const gradle of GRADLE_FILES) {
    const ids = idsFromFile(path.join(cwd, gradle), GRADLE_ID);
    if (ids.length > 0) return { ids, source: gradle };
  }

  const pbxproj = findPbxproj(cwd);
  if (pbxproj) {
    const ids = idsFromFile(pbxproj, PBXPROJ_ID).filter((id) => !/[$()]/.test(id));
    if (ids.length > 0) return { ids, source: path.relative(cwd, pbxproj) };
  }

  const expo = idsFromAppJson(path.join(cwd, 'app.json'));
  if (expo.length > 0) return { ids: expo, source: 'app.json' };

  return { ids: [], source: null };
}

export function matchesSessionApp(appId: string | undefined, ids: string[]): boolean {
  if (!appId) return false;
  return ids.some((id) => appId === id || appId.startsWith(`${id}.`));
}

function idsFromFile(file: string, pattern: RegExp): string[] {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf-8');
  return [...new Set([...text.matchAll(pattern)].map((match) => match[1]))];
}

function findPbxproj(cwd: string): string | null {
  const ios = path.join(cwd, 'ios');
  if (!existsSync(ios)) return null;
  const project = readdirSync(ios).find((entry) => entry.endsWith('.xcodeproj'));
  return project ? path.join(ios, project, 'project.pbxproj') : null;
}

function idsFromAppJson(file: string): string[] {
  if (!existsSync(file)) return [];
  try {
    const json = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
    const expo = (json.expo as Record<string, unknown> | undefined) ?? json;
    const android = (expo.android as { package?: string } | undefined)?.package;
    const ios = (expo.ios as { bundleIdentifier?: string } | undefined)?.bundleIdentifier;
    return [...new Set([android, ios].filter((id): id is string => typeof id === 'string' && id.length > 0))];
  } catch {
    return [];
  }
}

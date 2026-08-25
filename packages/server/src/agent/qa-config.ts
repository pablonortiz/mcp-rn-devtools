import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

/** Persistent cockpit config: which repo each app's fixes belong to. */
export interface QAConfig {
  /** applicationId → absolute repo path where the agent runs. */
  apps: Record<string, string>;
  /** Model for the fix agent's claude -p turns (alias or full id). Empty = CLI default. */
  agentModel?: string;
}

export function configPath(baseDir: string): string {
  return path.join(baseDir, 'config.json');
}

export async function readConfig(baseDir: string): Promise<QAConfig> {
  try {
    const raw = await readFile(configPath(baseDir), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<QAConfig>;
    return { apps: parsed.apps ?? {}, agentModel: parsed.agentModel };
  } catch {
    return { apps: {} };
  }
}

export async function writeConfig(baseDir: string, config: QAConfig): Promise<void> {
  await mkdir(baseDir, { recursive: true });
  await writeFile(configPath(baseDir), JSON.stringify(config, null, 2));
}

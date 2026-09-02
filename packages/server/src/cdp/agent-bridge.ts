import type { ReduxActionEntry } from '@mcp-rn-devtools/shared';
import type { CDPConnection } from './connection.js';
import { AGENT_GLOBAL_KEY, AGENT_SCRIPT } from './agent-script.js';
import { logger } from '../utils/logger.js';

export interface AgentDiscovery {
  hasHook: boolean;
  stores: string[];
  queryClient: boolean;
  navigation: boolean;
  visited: number;
}

export interface AgentStateResult {
  found: boolean;
  stores: string[];
  store?: string;
  path?: string | null;
  missing?: boolean;
  error?: string;
  data?: unknown;
}

export interface AgentStorageResult {
  done: boolean;
  ok?: boolean;
  value?: unknown;
  error?: string | null;
}

/**
 * Server-side counterpart of the injected runtime agent. Zero-config channel:
 * everything goes through Runtime.evaluate against the app's Hermes runtime.
 * Async in-app operations use kick-and-poll (CDP awaitPromise can't resolve
 * RN's polyfilled Promises).
 */
export class AgentBridge {
  private requestCounter = 0;

  async inject(cdp: CDPConnection): Promise<boolean> {
    try {
      const result = await this.rawEval(cdp, AGENT_SCRIPT);
      logger.info(`Runtime agent: ${result}`);
      return result === 'installed' || result === 'already-installed';
    } catch (e) {
      logger.warn('Failed to inject runtime agent', (e as Error).message);
      return false;
    }
  }

  async discover(cdp: CDPConnection): Promise<AgentDiscovery | null> {
    const json = await this.agentEval(cdp, `JSON.stringify(a.discover())`);
    return json ? (JSON.parse(json) as AgentDiscovery) : null;
  }

  /** Discovery summary without re-walking the fiber tree. */
  async summary(cdp: CDPConnection): Promise<{
    stores: string[];
    queryClient: boolean;
    navigation: boolean;
    pendingActions: number;
  } | null> {
    const json = await this.agentEval(cdp, `a.summaryJson()`);
    return json ? JSON.parse(json) : null;
  }

  async getState(
    cdp: CDPConnection,
    name?: string,
    path?: string,
    depth: number = 4,
  ): Promise<AgentStateResult | null> {
    await this.ensureDiscovered(cdp);
    const json = await this.agentEval(
      cdp,
      `a.getStateJson(${JSON.stringify(name ?? null)}, ${JSON.stringify(path ?? null)}, ${depth})`,
    );
    return json ? (JSON.parse(json) as AgentStateResult) : null;
  }

  async dispatch(
    cdp: CDPConnection,
    storeName: string | undefined,
    action: { type: string; payload?: unknown },
  ): Promise<{ ok: boolean; store?: string; stores?: string[]; error?: string } | null> {
    await this.ensureDiscovered(cdp);
    const json = await this.agentEval(
      cdp,
      `a.dispatchJson(${JSON.stringify(storeName ?? null)}, ${JSON.stringify(action)})`,
    );
    return json ? JSON.parse(json) : null;
  }

  async drainActions(cdp: CDPConnection): Promise<ReduxActionEntry[]> {
    await this.ensureDiscovered(cdp);
    const json = await this.agentEval(cdp, `a.drainActionsJson()`);
    if (!json) return [];
    try {
      return JSON.parse(json) as ReduxActionEntry[];
    } catch {
      return [];
    }
  }

  async getNavigation(cdp: CDPConnection): Promise<{
    found: boolean;
    currentRoute?: unknown;
    state?: unknown;
    error?: string;
  } | null> {
    await this.ensureDiscovered(cdp);
    const json = await this.agentEval(cdp, `a.getNavigationJson()`);
    return json ? JSON.parse(json) : null;
  }

  /** URL of the JS bundle the app loaded (from the SourceCode native module). */
  async getScriptUrl(cdp: CDPConnection): Promise<string | null> {
    const json = await this.agentEval(cdp, `a.scriptUrlJson()`);
    if (!json) return null;
    const parsed = JSON.parse(json) as { url?: string | null };
    return parsed.url ?? null;
  }

  /** Navigates through the discovered React Navigation container (zero-config return to a screen). */
  async qaNavigate(
    cdp: CDPConnection,
    name: string,
    params?: Record<string, unknown>,
  ): Promise<{ ok: boolean; notReady?: boolean; error?: string }> {
    const json = await this.agentEval(
      cdp,
      `a.qaNavigateJson(${JSON.stringify(name)}, ${JSON.stringify(params ?? null)})`,
    );
    return json ? JSON.parse(json) : { ok: false, error: 'agent not available' };
  }

  async storageOp(
    cdp: CDPConnection,
    op: 'keys' | 'get' | 'set' | 'remove',
    key?: string,
    value?: string,
    timeoutMs: number = 3000,
  ): Promise<AgentStorageResult> {
    const id = `storage-${Date.now()}-${++this.requestCounter}`;
    const kick = await this.agentEval(
      cdp,
      `a.storageKick(${JSON.stringify(id)}, ${JSON.stringify(op)}, ${JSON.stringify(key ?? null)}, ${JSON.stringify(value ?? null)})`,
    );
    if (kick === null) return { done: true, ok: false, error: 'agent not available' };

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
      const json = await this.agentEval(cdp, `a.readResultJson(${JSON.stringify(id)})`);
      if (!json) continue;
      const result = JSON.parse(json) as AgentStorageResult;
      if (result.done) return result;
    }
    return { done: true, ok: false, error: `storage ${op} timed out after ${timeoutMs}ms` };
  }

  /**
   * Hit-tests the app's view tree at a point (dp) via the injected agent —
   * zero-config element inspection for the cockpit's "Marcar" mode.
   */
  async qaHitTest(
    cdp: CDPConnection,
    x: number,
    y: number,
    timeoutMs: number = 4000,
  ): Promise<AgentStorageResult> {
    const id = `qa-hit-${Date.now()}-${++this.requestCounter}`;
    const kick = await this.agentEval(
      cdp,
      `a.qaHitTestKick(${JSON.stringify(id)}, ${Number(x)}, ${Number(y)})`,
    );
    if (kick === null) return { done: true, ok: false, error: 'agent not available' };
    return this.pollResult(cdp, id, timeoutMs, 'qa hit-test');
  }

  /** Measures another hierarchy level from the last qaHitTest (◀▶ navigation). */
  async qaMeasureLevel(
    cdp: CDPConnection,
    index: number,
    timeoutMs: number = 3000,
  ): Promise<AgentStorageResult> {
    const id = `qa-level-${Date.now()}-${++this.requestCounter}`;
    const kick = await this.agentEval(
      cdp,
      `a.qaMeasureLevelKick(${JSON.stringify(id)}, ${Number(index)})`,
    );
    if (kick === null) return { done: true, ok: false, error: 'agent not available' };
    return this.pollResult(cdp, id, timeoutMs, 'qa level measure');
  }

  private async pollResult(
    cdp: CDPConnection,
    id: string,
    timeoutMs: number,
    label: string,
  ): Promise<AgentStorageResult> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 120));
      const json = await this.agentEval(cdp, `a.readResultJson(${JSON.stringify(id)})`);
      if (!json) continue;
      const result = JSON.parse(json) as AgentStorageResult;
      if (result.done) return result;
    }
    return { done: true, ok: false, error: `${label} timed out after ${timeoutMs}ms` };
  }

  /** Runs discovery if no stores are registered yet (app may render after connect). */
  private async ensureDiscovered(cdp: CDPConnection): Promise<void> {
    const summary = await this.summary(cdp);
    if (!summary || summary.stores.length === 0) {
      await this.discover(cdp).catch(() => null);
    }
  }

  /**
   * Evaluates an expression against the installed agent (bound as `a`).
   * Re-injects on demand — the runtime is wiped on every bundle reload.
   */
  private async agentEval(cdp: CDPConnection, expr: string): Promise<string | null> {
    const wrapped = `(function() {
      var g = (typeof globalThis !== 'undefined' ? globalThis : global);
      var a = g.${AGENT_GLOBAL_KEY};
      if (!a) return null;
      return ${expr};
    })()`;

    let value = await this.rawEval(cdp, wrapped);
    if (value === null || value === undefined) {
      const injected = await this.inject(cdp);
      if (!injected) return null;
      value = await this.rawEval(cdp, wrapped);
    }
    return (value as string | null) ?? null;
  }

  private async rawEval(cdp: CDPConnection, expression: string): Promise<unknown> {
    const response = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    const exceptionDetails = response.exceptionDetails as Record<string, unknown> | undefined;
    if (exceptionDetails) {
      const exception = exceptionDetails.exception as Record<string, unknown> | undefined;
      throw new Error(
        (exception?.description as string) ?? (exceptionDetails.text as string) ?? 'evaluate failed',
      );
    }
    return (response.result as Record<string, unknown> | undefined)?.value;
  }
}

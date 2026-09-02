import { z } from 'zod';
import type { ToolRegistrar } from './registrar.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import type { CDPConnection } from '../cdp/connection.js';
import { evaluateByValue } from '../cdp/evaluate.js';

const EVAL_SLOTS_KEY = '__RN_DEVTOOLS_EVAL__';
const POLL_INTERVAL_MS = 100;

/**
 * Hermes' evaluate scope has no `global` binding (Metro only passes it to
 * module factories) and its eval is always indirect, so aliasing `global` for
 * the duration of the call is the only way `global.foo` works like in app code.
 * Statements and completion values behave like a plain Runtime.evaluate.
 */
export function withGlobalAlias(expression: string): string {
  return `(function() {
  var g = (typeof globalThis !== 'undefined' ? globalThis : this);
  var had = ('global' in g);
  if (!had) g.global = g;
  try { return (0, eval)(${JSON.stringify(expression)}); }
  finally { if (!had) delete g.global; }
})()`;
}

// CDP's awaitPromise never resolves RN's polyfilled Promise: settle it in-app
// into a slot and poll that slot instead.
function awaitingScript(expression: string, id: string): string {
  return `(function() {
  var g = (typeof globalThis !== 'undefined' ? globalThis : this);
  var slots = g.${EVAL_SLOTS_KEY} || (g.${EVAL_SLOTS_KEY} = {});
  var id = ${JSON.stringify(id)};
  function serialize(v) { try { var s = JSON.stringify(v); return s === undefined ? String(v) : s; } catch (e) { return String(v); } }
  function describeError(e) { return (e && (e.stack || e.message)) || String(e); }
  function settle(ok, v) { slots[id] = { done: true, ok: ok, value: ok ? serialize(v) : describeError(v) }; }
  var result;
  try { result = ${withGlobalAlias(expression)}; }
  catch (e) { settle(false, e); return 'sync'; }
  if (result && typeof result.then === 'function') {
    slots[id] = { done: false };
    result.then(function(v) { settle(true, v); }, function(e) { settle(false, e); });
    return 'pending';
  }
  settle(true, result);
  return 'sync';
})()`;
}

function readSlotScript(id: string): string {
  return `(function() {
  var g = (typeof globalThis !== 'undefined' ? globalThis : this);
  var slots = g.${EVAL_SLOTS_KEY} || {};
  var slot = slots[${JSON.stringify(id)}];
  if (!slot) return JSON.stringify({ done: false });
  if (slot.done) delete slots[${JSON.stringify(id)}];
  return JSON.stringify(slot);
})()`;
}

export interface SettledEvaluation {
  ok: boolean;
  /** JSON text of the resolved value, or the error description. */
  value: string;
}

/** Evaluates and, when the result is a thenable, waits in-app for it to settle. */
export async function evaluateAwaiting(
  cdp: CDPConnection,
  expression: string,
  timeoutMs: number,
): Promise<SettledEvaluation> {
  const id = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await evaluateByValue(cdp, awaitingScript(expression, id));

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const raw = (await evaluateByValue(cdp, readSlotScript(id))) as string;
    const slot = JSON.parse(raw) as { done: boolean; ok?: boolean; value?: string };
    if (slot.done) return { ok: slot.ok ?? false, value: slot.value ?? 'undefined' };
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return { ok: false, value: `Promise did not settle within ${timeoutMs}ms` };
}

export function registerEvaluateJS(server: ToolRegistrar, cm: ConnectionManager): void {
  server.tool(
    'evaluate_js',
    'Execute JavaScript in the React Native app (Hermes) via CDP Runtime.evaluate. Runs in the global scope: `globalThis` and `global` both work, `require` does not exist — reach modules through globals or the discovered Redux store. Set await_promise to wait for a Promise result (settled in-app, polled).',
    {
      expression: z.string().describe('JavaScript expression (or statements; the last expression is the result)'),
      await_promise: z
        .boolean()
        .optional()
        .default(false)
        .describe('If the result is a Promise, wait for it to settle and return the resolved value'),
      timeout_ms: z
        .number()
        .min(100)
        .max(30000)
        .optional()
        .default(5000)
        .describe('How long to wait for a Promise when await_promise is set'),
      return_by_value: z
        .boolean()
        .optional()
        .default(true)
        .describe('If true, returns the result serialized by value (default). Set to false for large objects to get a preview instead.'),
    },
    async ({ expression, await_promise, timeout_ms, return_by_value }) => {
      if (!cm.connected) {
        return text('Not connected to a React Native app — run health_check for the diagnosis.');
      }

      try {
        if (await_promise) {
          const settled = await evaluateAwaiting(cm.cdp, expression, timeout_ms);
          return settled.ok
            ? text(prettyJson(settled.value))
            : { ...text(`Evaluation error: ${settled.value}`), isError: true };
        }

        const response = await cm.cdp.send('Runtime.evaluate', {
          expression: withGlobalAlias(expression),
          returnByValue: return_by_value,
          generatePreview: !return_by_value,
        });

        const result = response.result as Record<string, unknown> | undefined;
        if (!result) return text('No result returned.');

        const exceptionDetails = response.exceptionDetails as Record<string, unknown> | undefined;
        if (exceptionDetails) {
          const exText = (exceptionDetails.text as string) ?? 'Unknown error';
          const exception = exceptionDetails.exception as Record<string, unknown> | undefined;
          const desc = (exception?.description as string) ?? '';
          return { ...text(`Evaluation error: ${exText}${desc ? `\n${desc}` : ''}`), isError: true };
        }

        return text(formatResult(result));
      } catch (e) {
        return { ...text(`Failed to evaluate: ${(e as Error).message}`), isError: true };
      }
    },
  );
}

function text(message: string) {
  return { content: [{ type: 'text' as const, text: message }] };
}

function prettyJson(json: string): string {
  try {
    const parsed = JSON.parse(json);
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
  } catch {
    return json;
  }
}

function formatResult(result: Record<string, unknown>): string {
  const type = result.type as string;
  const subtype = result.subtype as string | undefined;
  const value = result.value;
  const description = result.description as string | undefined;
  const preview = result.preview as Record<string, unknown> | undefined;

  // Undefined
  if (type === 'undefined') return 'undefined';

  // Null
  if (subtype === 'null') return 'null';

  // Primitive types returned by value
  if (value !== undefined) {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  // Object preview (when returnByValue is false)
  if (preview) {
    return formatPreview(preview);
  }

  // Fallback to description
  if (description) return description;

  return `[${type}${subtype ? `:${subtype}` : ''}]`;
}

function formatPreview(preview: Record<string, unknown>): string {
  const type = preview.type as string;
  const subtype = preview.subtype as string | undefined;
  const description = preview.description as string | undefined;
  const properties = preview.properties as Array<{
    name: string;
    type: string;
    value?: string;
  }> | undefined;
  const overflow = preview.overflow as boolean | undefined;

  if (!properties || properties.length === 0) {
    return description ?? `[${type}]`;
  }

  const isArray = subtype === 'array';
  const entries = properties.map((p) => {
    if (isArray) return p.value ?? `[${p.type}]`;
    return `${p.name}: ${p.value ?? `[${p.type}]`}`;
  });

  const suffix = overflow ? ', ...' : '';

  if (isArray) {
    return `[${entries.join(', ')}${suffix}]`;
  }
  return `{${entries.join(', ')}${suffix}}`;
}

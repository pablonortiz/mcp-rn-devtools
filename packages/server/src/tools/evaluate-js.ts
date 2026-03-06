import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerEvaluateJS(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'evaluate_js',
    'Execute JavaScript in the React Native app context via CDP Runtime.evaluate. Use for inspecting state, refs, timers, or any runtime value. Expression runs in the global scope of the Hermes JS engine.',
    {
      expression: z.string().describe('JavaScript expression to evaluate'),
      await_promise: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, awaits the result if it is a Promise'),
      return_by_value: z
        .boolean()
        .optional()
        .default(true)
        .describe('If true, returns the result serialized by value (default). Set to false for large objects to get a preview instead.'),
    },
    async ({ expression, await_promise, return_by_value }) => {
      if (!cm.connected) {
        return {
          content: [
            {
              type: 'text',
              text: 'Not connected to a React Native app. Make sure Metro is running and a Hermes-powered app is active.',
            },
          ],
        };
      }

      try {
        const response = await cm.cdp.send('Runtime.evaluate', {
          expression,
          returnByValue: return_by_value,
          generatePreview: !return_by_value,
          awaitPromise: await_promise,
          timeout: 10000,
        });

        const resp = response as Record<string, unknown>;
        const result = resp.result as Record<string, unknown> | undefined;

        if (!result) {
          return {
            content: [{ type: 'text', text: 'No result returned.' }],
          };
        }

        // Check for exception
        const exceptionDetails = resp.exceptionDetails as Record<string, unknown> | undefined;
        if (exceptionDetails) {
          const exText = (exceptionDetails.text as string) ?? 'Unknown error';
          const exception = exceptionDetails.exception as Record<string, unknown> | undefined;
          const desc = (exception?.description as string) ?? '';
          return {
            content: [
              {
                type: 'text',
                text: `Evaluation error: ${exText}${desc ? `\n${desc}` : ''}`,
              },
            ],
            isError: true,
          };
        }

        // Format the result
        const formatted = formatResult(result);

        return {
          content: [{ type: 'text', text: formatted }],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to evaluate: ${(e as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
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

import type { CDPConnection } from './connection.js';

/**
 * Runtime.evaluate by value. A JS exception inside the app arrives as
 * `exceptionDetails` on a successful response; here it becomes a thrown Error
 * instead of a silent `undefined`.
 */
export async function evaluateByValue(cdp: CDPConnection, expression: string): Promise<unknown> {
  const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
  throwOnException(response);
  return (response.result as Record<string, unknown> | undefined)?.value;
}

export function throwOnException(response: Record<string, unknown>): void {
  const details = response.exceptionDetails as Record<string, unknown> | undefined;
  if (!details) return;
  const exception = details.exception as Record<string, unknown> | undefined;
  throw new Error(
    (exception?.description as string) ?? (details.text as string) ?? 'evaluate failed',
  );
}

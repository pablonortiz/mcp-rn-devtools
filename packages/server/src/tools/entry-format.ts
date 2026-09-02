import type { ConsoleLogEntry, ErrorEntry, StackFrame } from '@mcp-rn-devtools/shared';
import { joinWithinBudget, truncateText } from '../utils/text.js';

export const MESSAGE_CHARS = 400;
export const STACK_FRAMES = 5;
export const OUTPUT_CHARS = 12_000;

// Hermes frames carry the whole bundle URL with its query string (~200 chars
// each); the file name is what a reader needs to tell frames apart.
function frameLocation(url: string | undefined, full: boolean): string {
  if (!url) return '<unknown>';
  if (full) return url;
  const path = url.replace(/\/\/&.*$/, '').replace(/\?.*$/, '');
  return path.slice(path.lastIndexOf('/') + 1) || url;
}

function formatFrames(frames: StackFrame[] | undefined, full: boolean): string {
  if (!frames?.length) return '';
  const shown = full ? frames : frames.slice(0, STACK_FRAMES);
  const lines = shown.map(
    (frame) =>
      `${frame.functionName || '<anonymous>'} (${frameLocation(frame.url, full)}:${frame.lineNumber}:${frame.columnNumber})`,
  );
  const hidden = frames.length - shown.length;
  if (hidden > 0) lines.push(`… +${hidden} frames`);
  return `\n  at ${lines.join('\n  at ')}`;
}

function formatMessage(text: string, full: boolean): string {
  return full ? text : truncateText(text, MESSAGE_CHARS);
}

export function formatLogEntry(log: ConsoleLogEntry, full: boolean): string {
  const time = new Date(log.timestamp).toISOString();
  return `[${time}] [${log.level.toUpperCase()}] ${formatMessage(log.message, full)}${formatFrames(log.stackTrace, full)}`;
}

export function formatErrorEntry(error: ErrorEntry, full: boolean): string {
  const time = new Date(error.timestamp).toISOString();
  const fatal = error.isFatal ? ' [FATAL]' : '';
  const component = error.componentStack
    ? `\nComponent stack: ${formatMessage(error.componentStack, full)}`
    : '';
  return `[${time}]${fatal} ${formatMessage(error.message, full)}${formatFrames(error.stack, full)}${component}`;
}

export function formatWarningEntry(warning: ErrorEntry, full: boolean): string {
  const time = new Date(warning.timestamp).toISOString();
  return `[${time}] ${formatMessage(warning.message, full)}${formatFrames(warning.stack, full)}`;
}

/** Newest entries within the output budget, with a note about what was left out. */
export function renderEntries(label: string, blocks: string[], full: boolean): string {
  const { text, omitted } = full
    ? { text: blocks.join('\n\n'), omitted: 0 }
    : joinWithinBudget(blocks, OUTPUT_CHARS);
  const note = omitted > 0
    ? ` (showing the newest ${blocks.length - omitted}; narrow with search/since/limit, or pass full=true)`
    : '';
  return `${blocks.length} ${label}${note}:\n\n${text}`;
}

export const FULL_PARAM_DESCRIPTION =
  'Untruncated output: whole messages, every stack frame and no total size cap (default caps each message, keeps 5 frames and the newest entries that fit)';

export function notConnectedHint(cm: { connected: boolean; sdkConnected: boolean }, what: string): string {
  const sources: string[] = [];
  if (cm.connected) sources.push('CDP');
  if (cm.sdkConnected) sources.push('SDK');
  const status = sources.length > 0
    ? `Connected via ${sources.join(' + ')}.`
    : 'Not connected to a React Native app — run health_check for the diagnosis.';
  return `No ${what} found matching the criteria. ${status}`;
}

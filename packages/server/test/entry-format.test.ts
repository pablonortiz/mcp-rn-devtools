import { describe, it, expect } from 'vitest';
import type { ErrorEntry } from '@mcp-rn-devtools/shared';
import { formatErrorEntry, renderEntries, MESSAGE_CHARS, OUTPUT_CHARS } from '../src/tools/entry-format.js';

const BUNDLE_URL = 'http://10.0.2.2:8081/index.bundle//&platform=android&dev=true&lazy=true&app=com.example';
const frames = Array.from({ length: 12 }, (_, index) => ({
  functionName: `fn${index}`,
  url: BUNDLE_URL,
  lineNumber: index,
  columnNumber: 1,
}));

const error: ErrorEntry = {
  id: 'e1',
  timestamp: 0,
  message: 'x'.repeat(MESSAGE_CHARS + 100),
  stack: frames,
  isFatal: false,
  source: 'cdp',
};

describe('entry formatting', () => {
  it('caps the message and the stack by default, and shortens bundle URLs to the file name', () => {
    const text = formatErrorEntry(error, false);
    expect(text).toContain('[+100 chars]');
    expect(text).toContain('fn4 (index.bundle:4:1)');
    expect(text).not.toContain('fn5 (');
    expect(text).toContain('… +7 frames');
    expect(text).not.toContain('platform=android');
  });

  it('prints everything with full=true', () => {
    const text = formatErrorEntry(error, true);
    expect(text).not.toContain('[+100 chars]');
    expect(text).toContain(`fn11 (${BUNDLE_URL}:11:1)`);
  });

  it('keeps the newest entries within the output budget and says so', () => {
    const blocks = Array.from({ length: 40 }, (_, index) => `entry-${index} ${'y'.repeat(500)}`);
    const text = renderEntries('error(s)', blocks, false);
    expect(text.length).toBeLessThan(OUTPUT_CHARS + 300);
    expect(text).toContain('entry-39');
    expect(text).not.toContain('entry-0 ');
    expect(text).toMatch(/40 error\(s\) \(showing the newest \d+;/);
  });
});

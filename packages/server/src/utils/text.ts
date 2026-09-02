const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}… [+${text.length - maxChars} chars]`;
}

/**
 * Keeps the newest blocks that fit the character budget (blocks arrive
 * oldest-first) and reports how many older ones were left out.
 */
export function joinWithinBudget(
  blocks: string[],
  maxChars: number,
  separator = '\n\n',
): { text: string; omitted: number } {
  const kept: string[] = [];
  let used = 0;
  for (let index = blocks.length - 1; index >= 0; index--) {
    const cost = blocks[index].length + (kept.length > 0 ? separator.length : 0);
    if (kept.length > 0 && used + cost > maxChars) break;
    kept.unshift(blocks[index]);
    used += cost;
  }
  return { text: kept.join(separator), omitted: blocks.length - kept.length };
}

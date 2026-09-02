const DEFAULT_CAPACITY = 2000;

/**
 * Runtime.enable replays the runtime's console backlog on every (re)connection.
 * The same (timestamp, message) pair must be recorded once, no matter how many
 * times the debugger reattaches.
 */
export class ReplayFilter {
  private keys = new Set<string>();

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {}

  /** True when this entry was already seen; records it otherwise. */
  isDuplicate(entry: { timestamp: number; message: string }): boolean {
    const key = `${entry.timestamp}|${entry.message}`;
    if (this.keys.has(key)) return true;
    this.keys.add(key);
    if (this.keys.size > this.capacity) {
      this.keys.delete(this.keys.values().next().value as string);
    }
    return false;
  }
}

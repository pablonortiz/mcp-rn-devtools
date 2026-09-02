import { describe, it, expect } from 'vitest';
import { LogManager } from '../src/managers/log-manager.js';
import { ErrorManager } from '../src/managers/error-manager.js';
import { ReplayFilter } from '../src/managers/replay-filter.js';

const ESC = String.fromCharCode(27);
const warning = (timestamp: number, text: string) => ({
  type: 'warning',
  args: [{ type: 'string', value: text }],
  timestamp,
});

describe('console replay dedup', () => {
  it('records a replayed warning once across reconnections', () => {
    const errors = new ErrorManager();
    const backlog = [warning(1000.5, 'Deep imports are deprecated'), warning(1001.2, 'no-op')];
    for (const round of [1, 2, 3]) {
      for (const entry of backlog) errors.addFromCDP(entry);
      expect(errors.warningsCount, `after replay ${round}`).toBe(2);
    }
  });

  it('keeps two different warnings emitted with the same text at different times', () => {
    const errors = new ErrorManager();
    errors.addFromCDP(warning(1, 'same text'));
    errors.addFromCDP(warning(2, 'same text'));
    expect(errors.warningsCount).toBe(2);
  });

  it('dedups replayed logs and drops the Hermes unsupported-client notice', () => {
    const logs = new LogManager();
    const notice = {
      type: 'info',
      args: [{ type: 'string', value: `${ESC}[1mNOTE: ${ESC}[22mYou are using an unsupported debugging client. Use the Dev Menu…` }],
      timestamp: 5,
    };
    const regular = { type: 'log', args: [{ type: 'string', value: 'booted' }], timestamp: 6 };
    logs.addFromCDP(notice);
    logs.addFromCDP(regular);
    logs.addFromCDP(regular);
    expect(logs.getLogs().map((entry) => entry.message)).toEqual(['booted']);
  });

  it('strips color codes from messages', () => {
    const logs = new LogManager();
    logs.addFromCDP({ type: 'log', args: [{ type: 'string', value: `${ESC}[31mred alert${ESC}[0m` }], timestamp: 1 });
    expect(logs.getLogs()[0].message).toBe('red alert');
  });

  it('bounds its memory', () => {
    const filter = new ReplayFilter(3);
    for (let index = 0; index < 10; index++) filter.isDuplicate({ timestamp: index, message: 'm' });
    expect(filter.isDuplicate({ timestamp: 0, message: 'm' })).toBe(false);
    expect(filter.isDuplicate({ timestamp: 9, message: 'm' })).toBe(true);
  });
});

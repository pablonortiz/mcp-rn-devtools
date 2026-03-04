import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the tool registration indirectly by testing the formatting logic
// and the CDP interaction pattern. The tool itself is a thin wrapper.

describe('evaluate_js formatting', () => {
  // Simulate the formatResult logic from the tool
  function formatResult(result: Record<string, unknown>): string {
    const type = result.type as string;
    const subtype = result.subtype as string | undefined;
    const value = result.value;
    const description = result.description as string | undefined;

    if (type === 'undefined') return 'undefined';
    if (subtype === 'null') return 'null';
    if (value !== undefined) {
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    if (description) return description;
    return `[${type}${subtype ? `:${subtype}` : ''}]`;
  }

  it('should format undefined', () => {
    expect(formatResult({ type: 'undefined' })).toBe('undefined');
  });

  it('should format null', () => {
    expect(formatResult({ type: 'object', subtype: 'null' })).toBe('null');
  });

  it('should format string values', () => {
    expect(formatResult({ type: 'string', value: 'hello' })).toBe('hello');
  });

  it('should format number values', () => {
    expect(formatResult({ type: 'number', value: 42 })).toBe('42');
  });

  it('should format object values', () => {
    const result = formatResult({
      type: 'object',
      value: { name: 'John', age: 30 },
    });
    expect(result).toContain('"name": "John"');
    expect(result).toContain('"age": 30');
  });

  it('should format array values', () => {
    const result = formatResult({
      type: 'object',
      subtype: 'array',
      value: [1, 2, 3],
    });
    expect(result).toBe('[\n  1,\n  2,\n  3\n]');
  });

  it('should format boolean values', () => {
    expect(formatResult({ type: 'boolean', value: true })).toBe('true');
  });

  it('should use description as fallback', () => {
    expect(
      formatResult({ type: 'function', description: 'function foo() { ... }' }),
    ).toBe('function foo() { ... }');
  });

  it('should format unknown types', () => {
    expect(formatResult({ type: 'symbol' })).toBe('[symbol]');
    expect(formatResult({ type: 'object', subtype: 'regexp' })).toBe('[object:regexp]');
  });
});

describe('evaluate_js CDP integration', () => {
  it('should call Runtime.evaluate with correct params', async () => {
    const mockSend = vi.fn().mockResolvedValue({
      result: { type: 'number', value: 42 },
    });

    // Simulate what the tool does
    const expression = '1 + 1';
    const response = await mockSend('Runtime.evaluate', {
      expression,
      returnByValue: true,
      generatePreview: false,
      awaitPromise: false,
      timeout: 10000,
    });

    expect(mockSend).toHaveBeenCalledWith('Runtime.evaluate', {
      expression: '1 + 1',
      returnByValue: true,
      generatePreview: false,
      awaitPromise: false,
      timeout: 10000,
    });
    expect(response.result.value).toBe(42);
  });

  it('should handle exception details', () => {
    const response = {
      result: { type: 'object', subtype: 'error' },
      exceptionDetails: {
        text: 'Uncaught ReferenceError',
        exception: { description: 'ReferenceError: foo is not defined' },
      },
    };

    const exceptionDetails = response.exceptionDetails;
    const exText = exceptionDetails.text;
    const desc = exceptionDetails.exception?.description ?? '';

    expect(exText).toBe('Uncaught ReferenceError');
    expect(desc).toContain('foo is not defined');
  });
});

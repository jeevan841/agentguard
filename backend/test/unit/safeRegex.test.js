/**
 * test/unit/safeRegex.test.js
 *
 * Regression tests for Fix #2:
 *   - ReDoS protection via worker_thread (NOT setTimeout)
 *   - A genuinely catastrophic pattern must be terminated quickly,
 *     not hang the process.
 */
'use strict';

const { safeRegexTest, safeRegexMatch, safeRegexScan, safeRegexReplace } = require('../../src/utils/safeRegex');

// Jest default timeout is 5 s; catastrophic pattern must finish within 1 s.
jest.setTimeout(10000);

describe('safeRegexTest', () => {
  test('returns true when pattern matches', async () => {
    const result = await safeRegexTest(/hello/i, 'Hello world');
    expect(result).toBe(true);
  });

  test('returns false when pattern does not match', async () => {
    const result = await safeRegexTest(/xyz123/, 'Hello world');
    expect(result).toBe(false);
  });
});

describe('safeRegexMatch', () => {
  test('returns matches array for a matching pattern', async () => {
    const result = await safeRegexMatch(/\d+/g, 'foo 123 bar 456');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain('123');
    expect(result).toContain('456');
  });

  test('returns null for no match', async () => {
    const result = await safeRegexMatch(/\d+/, 'no digits here');
    expect(result).toBeNull();
  });
});

describe('safeRegexReplace', () => {
  test('replaces matched text', async () => {
    const result = await safeRegexReplace(/\d+/g, 'foo 123 bar 456', 'NUM');
    expect(result).toBe('foo NUM bar NUM');
  });
});

describe('safeRegexScan', () => {
  test('returns detections for matching patterns', async () => {
    const patterns = [
      { type: 'EMAIL', pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, severity: 'medium' },
      { type: 'DIGITS', pattern: /\d+/g, severity: 'low' },
    ];
    const results = await safeRegexScan(patterns, 'Contact user@example.com or call 555');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const types = results.map((r) => r.type);
    expect(types).toContain('EMAIL');
  });

  test('returns empty array when nothing matches', async () => {
    const patterns = [
      { type: 'SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, severity: 'critical' },
    ];
    const results = await safeRegexScan(patterns, 'nothing here');
    expect(results).toEqual([]);
  });
});

// ─── CRITICAL ReDoS regression test (Fix #2) ──────────────────────────────────
describe('ReDoS protection — worker_thread hard termination', () => {
  /**
   * (a+)+$ is a textbook catastrophic backtracking pattern.
   * Against a long non-matching string it would take O(2^n) steps on a
   * naive backtracking engine — enough to hang the process for seconds.
   *
   * With genuine worker_thread termination this must resolve (via rejection)
   * in ≤ 500 ms, not hang.
   */
  test('catastrophic backtracking pattern (a+)+$ does NOT hang — rejects within timeout', async () => {
    const catastrophic = /(a+)+$/;
    // 30 'a's followed by a non-matching character — triggers exponential backtracking
    const evil = 'a'.repeat(30) + 'X';

    const start = Date.now();
    await expect(
      safeRegexTest(catastrophic, evil, 200) // 200 ms hard timeout
    ).rejects.toThrow(/timed out|ReDoS|exit/i);
    const elapsed = Date.now() - start;

    // Must have bailed out within 1 second (generous margin above 200 ms timeout)
    expect(elapsed).toBeLessThan(1000);
  });

  test('safe patterns still work normally after a timeout rejection', async () => {
    // Verify the module is not in a broken state after a timeout
    const result = await safeRegexTest(/hello/, 'hello world', 200);
    expect(result).toBe(true);
  });
});

/**
 * test/unit/PIIDetector.test.js
 *
 * Tests for Fix #1 regression:
 *   - detectPII() must return an object, never throw TypeError from a
 *     Promise being spread.
 *
 * Also tests basic correctness of PII detection patterns.
 *
 * Note: useAI=false is used throughout so no network / Claude SDK is needed.
 */
'use strict';

// The detectors call safeRegex which spawns workers — allow enough time.
jest.setTimeout(15000);

const { detectPII } = require('../../src/services/guardrail/PIIDetector');

describe('detectPII — Fix #1 regression (missing await)', () => {
  test('returns an object (not Promise, not TypeError) for normal text', async () => {
    const result = await detectPII('Hello, my name is Alice.', false);
    expect(result).toBeInstanceOf(Object);
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('detections');
    expect(Array.isArray(result.detections)).toBe(true);
  });

  test('result.detections is an Array (proves await was applied)', async () => {
    const result = await detectPII('no PII here', false);
    // Before the fix, this was a Promise — spread would throw TypeError.
    expect(Array.isArray(result.detections)).toBe(true);
  });
});

describe('detectPII — correctness', () => {
  test('detects SSN pattern', async () => {
    const result = await detectPII('My SSN is 123-45-6789.', false);
    expect(result.passed).toBe(false);
    const types = result.detections.map((d) => d.type);
    expect(types).toContain('SSN');
  });

  test('detects email address', async () => {
    const result = await detectPII('Contact me at alice@example.com please.', false);
    expect(result.passed).toBe(false);
    const types = result.detections.map((d) => d.type);
    expect(types).toContain('EMAIL');
  });

  test('detects credit card number', async () => {
    // Visa test number
    const result = await detectPII('Card: 4111111111111111', false);
    expect(result.passed).toBe(false);
    const types = result.detections.map((d) => d.type);
    expect(types).toContain('CREDIT_CARD');
  });

  test('detects phone number', async () => {
    const result = await detectPII('Call me at 555-867-5309.', false);
    expect(result.passed).toBe(false);
    const types = result.detections.map((d) => d.type);
    expect(types).toContain('PHONE');
  });

  test('passes clean text', async () => {
    const result = await detectPII('The weather today is sunny and warm.', false);
    expect(result.passed).toBe(true);
    expect(result.detections.length).toBe(0);
  });

  test('returns passed:true for empty string', async () => {
    const result = await detectPII('', false);
    expect(result.passed).toBe(true);
  });

  test('returns passed:true for non-string input', async () => {
    const result = await detectPII(null, false);
    expect(result.passed).toBe(true);
  });

  test('result has confidence field', async () => {
    const result = await detectPII('test text', false);
    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

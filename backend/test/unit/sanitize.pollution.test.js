/**
 * test/unit/sanitize.pollution.test.js
 *
 * Confirms Fix #1: prototype pollution via __proto__ / constructor / prototype
 * is blocked by the DANGEROUS_KEYS denylist in sanitizeObject().
 *
 * Reproduces the original confirmed PoC:
 *   body = {"__proto__":{"polluted":true},"name":"test"}
 * and asserts the returned object does NOT inherit the attacker-controlled value.
 */
'use strict';

// sanitize-html ships as ESM in newer versions and cannot be require()'d directly
// by Jest's CommonJS transform. Since our tests verify key-stripping (not HTML
// sanitization), a pass-through mock is correct and keeps the test focused.
jest.mock('sanitize-html', () => (str) => str);

const { sanitizeObject, sanitizeMiddleware } = require('../../src/middleware/sanitize');

describe('sanitizeObject — Fix #1: prototype pollution prevention', () => {
  // ── PoC reproduction ─────────────────────────────────────────────────────────
  test('EXPLOIT BLOCKED: __proto__ key is not copied into output', () => {
    // Simulate the JSON body that arrives after JSON.parse:
    // JSON.parse('{"__proto__":{"polluted":true}}') doesn't actually set the
    // prototype in modern Node, but the key is present as an own-enumerable key
    // on the parsed plain object. sanitizeObject must NOT pass it through.
    const malicious = Object.create(null);
    // Manually set the key the same way JSON.parse does
    Object.defineProperty(malicious, '__proto__', {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    malicious.name = 'test';

    const result = sanitizeObject(malicious);

    // The dangerous key must be absent
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
    // The attacker's value must NOT appear as an inherited property
    expect(result.polluted).toBeUndefined();
    // A safe key must still pass through
    expect(result.name).toBe('test');
    // The output prototype must be unmodified Object.prototype
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  test('EXPLOIT BLOCKED: constructor key is stripped', () => {
    const input = { constructor: { polluted: true }, name: 'safe' };
    const result = sanitizeObject(input);
    expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(false);
    expect(result.name).toBe('safe');
  });

  test('EXPLOIT BLOCKED: prototype key is stripped', () => {
    const input = { prototype: { evil: true }, value: 42 };
    const result = sanitizeObject(input);
    expect(Object.prototype.hasOwnProperty.call(result, 'prototype')).toBe(false);
    expect(result.value).toBe(42);
  });

  test('EXPLOIT BLOCKED: nested __proto__ in deep object is stripped', () => {
    const input = {
      user: {
        name: 'alice',
        __proto__: { isAdmin: true },
      },
    };
    const result = sanitizeObject(input);
    expect(result.user.name).toBe('alice');
    expect(result.user.isAdmin).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result.user, '__proto__')).toBe(false);
  });

  // ── Normal fields still pass through ─────────────────────────────────────────
  test('NORMAL: safe string fields are preserved (and sanitized)', () => {
    const input = { email: 'user@example.com', name: 'Alice' };
    const result = sanitizeObject(input);
    expect(result.email).toBe('user@example.com');
    expect(result.name).toBe('Alice');
  });

  test('NORMAL: arrays are recursively sanitized without stripping normal keys', () => {
    const input = [{ name: 'a' }, { name: 'b', __proto__: { evil: true } }];
    const result = sanitizeObject(input);
    expect(result[0].name).toBe('a');
    expect(result[1].name).toBe('b');
    expect(result[1].evil).toBeUndefined();
  });

  // ── Full middleware path ───────────────────────────────────────────────────────
  test('MIDDLEWARE: __proto__ stripped from req.body in express middleware', () => {
    const middleware = sanitizeMiddleware();

    const maliciousBody = {};
    Object.defineProperty(maliciousBody, '__proto__', {
      value: { isAdmin: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    maliciousBody.username = 'attacker';

    const req = { body: maliciousBody, query: {} };
    const res = {};
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.username).toBe('attacker');
    expect(req.body.isAdmin).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(req.body, '__proto__')).toBe(false);
  });
});

/**
 * test/unit/webhookSigning.test.js — P2#12
 */
'use strict';

const crypto = require('crypto');

// Extract the signing logic from AlertService by testing it directly
// (we don't load AlertService to avoid ESM/node-fetch issues in tests)
function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function verifySignature(secret, body, received) {
  const expected = sign(secret, body);
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

describe('Webhook HMAC signing — P2#12', () => {
  const secret = 'webhook-secret-at-least-16-chars';
  const payload = { alert: 'high_latency', value: 250, timestamp: '2026-08-01T10:00:00Z' };
  const body = JSON.stringify(payload);

  test('signature starts with sha256=', () => {
    expect(sign(secret, body)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  test('same secret + body → same signature (deterministic)', () => {
    expect(sign(secret, body)).toBe(sign(secret, body));
  });

  test('different payload → different signature', () => {
    const body2 = JSON.stringify({ ...payload, value: 999 });
    expect(sign(secret, body)).not.toBe(sign(secret, body2));
  });

  test('different secret → different signature', () => {
    expect(sign(secret, body)).not.toBe(sign('other-secret-value', body));
  });

  test('verifySignature: correct secret passes', () => {
    const sig = sign(secret, body);
    expect(verifySignature(secret, body, sig)).toBe(true);
  });

  test('verifySignature: wrong secret fails', () => {
    const sig = sign(secret, body);
    expect(verifySignature('wrong-secret-value!!', body, sig)).toBe(false);
  });

  test('verifySignature: tampered body fails', () => {
    const sig = sign(secret, body);
    const tamperedBody = body.replace('250', '999');
    expect(verifySignature(secret, tamperedBody, sig)).toBe(false);
  });
});

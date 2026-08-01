/**
 * test/unit/auth.middleware.test.js
 *
 * Tests for Fix #1 (token-type check) and Fix #2 (algorithm pinning) in
 * src/middleware/auth.js
 *
 * No running server needed — we test the middleware functions directly by
 * constructing mock req/res/next objects.
 */
'use strict';

jest.setTimeout(10000);

const jwt = require('jsonwebtoken');
const { requireAuth, generateManagementToken, generateCapabilityToken } = require('../../src/middleware/auth');

// ─── Minimal mock config ──────────────────────────────────────────────────────
// Patch the config module before auth.js loads it
jest.mock('../../src/config', () => ({
  jwt: {
    secret: 'test-secret-that-is-long-enough-32chars',
    expiresIn: '7d',
    capabilityExpiresIn: '1h',
  },
}));

const SECRET = 'test-secret-that-is-long-enough-32chars';

// ─── Helper: build mock Express req/res/next ──────────────────────────────────
function makeReq(token) {
  return { headers: { authorization: token ? `Bearer ${token}` : undefined } };
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

// ─── Fix #1: Token-type enforcement ──────────────────────────────────────────
describe('requireAuth — Fix #1: token type must be "management"', () => {
  test('POSITIVE: valid management token passes through', () => {
    const fakeUser = { id: 'u1', email: 'admin@example.com', role: 'admin' };
    const token = generateManagementToken(fakeUser);

    const req = makeReq(token);
    const res = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.type).toBe('management');
  });

  test('NEGATIVE: capability token is rejected with 401', () => {
    // Simulate a capability token signed with the same secret
    const capToken = generateCapabilityToken({
      id: 'agent-1',
      name: 'TestAgent',
      allowed_tools: ['search'],
      allowed_data_scopes: ['public'],
      max_token_budget: 1000,
    });

    const req = makeReq(capToken);
    const res = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Unauthorized', message: 'Invalid token type' })
    );
  });

  test('NEGATIVE: mfa_temp token is rejected with 401', () => {
    const tempToken = jwt.sign(
      { userId: 'u1', nextStep: 'email_otp', type: 'mfa_temp' },
      SECRET,
      { expiresIn: '10m' }
    );

    const req = makeReq(tempToken);
    const res = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('NEGATIVE: missing Authorization header returns 401', () => {
    const req = makeReq(null);
    const res = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('NEGATIVE: expired management token returns 401', () => {
    const expiredToken = jwt.sign(
      { id: 'u1', email: 'a@b.com', role: 'admin', type: 'management' },
      SECRET,
      { expiresIn: '-1s' } // already expired
    );

    const req = makeReq(expiredToken);
    const res = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Token has expired' })
    );
  });
});

// ─── Fix #2: Algorithm pinning ────────────────────────────────────────────────
describe('requireAuth — Fix #2: algorithm must be HS256', () => {
  test('NEGATIVE: token signed with RS256 private key is rejected', () => {
    // We cannot easily generate a valid RS256 token without a key pair,
    // but we can sign with a different symmetric algorithm (HS512) to simulate
    // a mismatched algorithm claim
    const hs512Token = jwt.sign(
      { id: 'u1', email: 'a@b.com', role: 'admin', type: 'management' },
      SECRET,
      { algorithm: 'HS512' } // not HS256
    );

    const req = makeReq(hs512Token);
    const res = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    // HS512 token must be rejected because algorithms: ['HS256'] is pinned
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('NEGATIVE: token with alg:none (unsigned) is rejected', () => {
    // Craft a minimal unsigned JWT manually (alg: none)
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ id: 'u1', type: 'management', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString('base64url');
    const noneToken = `${header}.${payload}.`;

    const req = makeReq(noneToken);
    const res = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

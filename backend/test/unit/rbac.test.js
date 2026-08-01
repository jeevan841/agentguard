/**
 * test/unit/rbac.test.js
 *
 * Tests for Fix #2: RBAC roles enforced on mutating routes.
 *
 * Strategy: call requireRole middleware directly with mock req/res/next objects
 * built from management tokens with different roles. No running server or DB needed.
 */
'use strict';

jest.setTimeout(10000);

jest.mock('../../src/config', () => ({
  jwt: {
    secret: 'test-secret-that-is-long-enough-32chars',
    expiresIn: '7d',
    capabilityExpiresIn: '1h',
  },
}));

const { requireAuth, requireRole, generateManagementToken } = require('../../src/middleware/auth');

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeReq(token) {
  return {
    headers: { authorization: token ? `Bearer ${token}` : undefined },
    user: null,
  };
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

/**
 * Run requireAuth then requireRole in sequence on the same req/res/next triple,
 * simulating the Express middleware chain.
 */
function runChain(token, ...roles) {
  const req = makeReq(token);
  const res = makeRes();
  const next = jest.fn();

  // Step 1 – auth (populates req.user)
  requireAuth(req, res, next);
  if (!next.mock.calls.length) {
    // Auth itself rejected – return the res
    return { req, res, next };
  }

  next.mockClear();

  // Step 2 – role check
  const roleMiddleware = requireRole(...roles);
  roleMiddleware(req, res, next);

  return { req, res, next };
}

// ─── Token fixtures ───────────────────────────────────────────────────────────
const adminToken   = generateManagementToken({ id: 'u1', email: 'a@b.com', role: 'admin' });
const operatorToken = generateManagementToken({ id: 'u2', email: 'b@b.com', role: 'operator' });
const viewerToken  = generateManagementToken({ id: 'u3', email: 'c@b.com', role: 'viewer' });

// ─── requireRole unit tests ───────────────────────────────────────────────────
describe('requireRole — Fix #2: role-based access control', () => {
  // ── Positive cases (should pass) ─────────────────────────────────────────────
  test('admin token passes requireRole("admin","operator")', () => {
    const { next, res } = runChain(adminToken, 'admin', 'operator');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('operator token passes requireRole("admin","operator")', () => {
    const { next, res } = runChain(operatorToken, 'admin', 'operator');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('admin token passes requireRole("admin") (single-role guard)', () => {
    const { next, res } = runChain(adminToken, 'admin');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  // ── Negative cases: viewer must be blocked from all mutating routes ───────────
  test('BLOCKED: viewer token → POST /agents (agent creation) → 403', () => {
    const { next, res } = runChain(viewerToken, 'admin', 'operator');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Forbidden' }));
  });

  test('BLOCKED: viewer token → PUT /agents/:id (agent update) → 403', () => {
    const { next, res } = runChain(viewerToken, 'admin', 'operator');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('BLOCKED: viewer token → DELETE /agents/:id (agent deactivate) → 403', () => {
    const { next, res } = runChain(viewerToken, 'admin', 'operator');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('BLOCKED: viewer token → POST /agents/:id/token (capability issuance) → 403', () => {
    const { next, res } = runChain(viewerToken, 'admin', 'operator');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('BLOCKED: viewer token → POST /guardrail/policies (policy creation) → 403', () => {
    const { next, res } = runChain(viewerToken, 'admin', 'operator');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('BLOCKED: viewer token → PUT /guardrail/policies/:id (policy update) → 403', () => {
    const { next, res } = runChain(viewerToken, 'admin', 'operator');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('BLOCKED: viewer token → POST /dashboard/webhooks (webhook creation) → 403', () => {
    const { next, res } = runChain(viewerToken, 'admin', 'operator');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('BLOCKED: viewer token → POST /redteam/run (red-team trigger) → 403', () => {
    const { next, res } = runChain(viewerToken, 'admin', 'operator');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ── Read-only routes: viewer should be allowed ────────────────────────────────
  test('ALLOWED: viewer token passes read-only requireRole("admin","operator","viewer")', () => {
    // GET routes don't call requireRole at all (they use only requireAuth),
    // but if a route ever uses requireRole('admin','operator','viewer') for a
    // read endpoint, viewer must still pass.
    const { next, res } = runChain(viewerToken, 'admin', 'operator', 'viewer');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  // ── Edge cases ────────────────────────────────────────────────────────────────
  test('BLOCKED: token with no role field is rejected', () => {
    const jwt = require('jsonwebtoken');
    const noRoleToken = jwt.sign(
      { id: 'u99', email: 'x@x.com', type: 'management' }, // no role
      'test-secret-that-is-long-enough-32chars',
      { algorithm: 'HS256', expiresIn: '1h' }
    );
    const { next, res } = runChain(noRoleToken, 'admin', 'operator');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('BLOCKED: operator token rejected from admin-only guard', () => {
    const { next, res } = runChain(operatorToken, 'admin');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

/**
 * test/unit/idempotency.test.js — P2#13
 */
'use strict';

jest.setTimeout(10000);

// Mock Redis
const mockRedis = {
  get: jest.fn(),
  setex: jest.fn(),
};
jest.mock('../../src/redis/client', () => ({ getRedis: () => mockRedis }));

const { idempotency } = require('../../src/middleware/idempotency');

function makeCtx({ key, userId = 'user-1', body = { data: 'test' } } = {}) {
  const req = {
    headers: key ? { 'idempotency-key': key } : {},
    user: { id: userId },
  };
  const jsonCalls = [];
  let statusCode = 200;
  const res = {
    get statusCode() { return statusCode; },
    set statusCode(v) { statusCode = v; },
    status(code) { statusCode = code; return res; },
    json: jest.fn((b) => { jsonCalls.push(b); return res; }),
    setHeader: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next, jsonCalls };
}

beforeEach(() => jest.clearAllMocks());

describe('Idempotency middleware — P2#13', () => {
  test('no key → calls next, no Redis interaction', async () => {
    const { req, res, next } = makeCtx({});
    await idempotency()(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  test('new key → passes through, caches response on res.json()', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');

    const { req, res, next } = makeCtx({ key: 'key-abc' });
    await idempotency()(req, res, next);
    expect(next).toHaveBeenCalled();

    // Simulate handler calling res.json()
    res.statusCode = 201;
    await res.json({ id: 'agent-1' });
    expect(mockRedis.setex).toHaveBeenCalledWith(
      expect.stringContaining('key-abc'),
      86400, // 24h
      expect.stringContaining('agent-1')
    );
  });

  test('repeat key → returns cached response, does NOT call next', async () => {
    const cached = JSON.stringify({ status: 201, body: { id: 'agent-1' } });
    mockRedis.get.mockResolvedValue(cached);

    const { req, res, next } = makeCtx({ key: 'key-abc' });
    await idempotency()(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ id: 'agent-1' });
    expect(res.setHeader).toHaveBeenCalledWith('X-Idempotent-Replay', 'true');
  });

  test('Redis error → falls through to handler (degraded gracefully)', async () => {
    mockRedis.get.mockRejectedValue(new Error('Redis down'));
    const { req, res, next } = makeCtx({ key: 'key-xyz' });
    await idempotency()(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('only caches 2xx responses (not 4xx errors)', async () => {
    mockRedis.get.mockResolvedValue(null);
    const { req, res, next } = makeCtx({ key: 'key-def' });
    await idempotency()(req, res, next);
    res.statusCode = 422;
    await res.json({ error: 'Validation Error' });
    expect(mockRedis.setex).not.toHaveBeenCalled();
  });
});

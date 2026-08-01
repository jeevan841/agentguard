/**
 * test/unit/requestId.test.js — P1#5
 */
'use strict';

const { requestId } = require('../../src/middleware/requestId');

function makeReqRes(headerValue) {
  const req = { headers: {} };
  if (headerValue) req.headers['x-request-id'] = headerValue;
  const res = { setHeader: jest.fn() };
  const next = jest.fn();
  return { req, res, next };
}

describe('requestId middleware — P1#5', () => {
  test('generates a UUID when header is absent', () => {
    const { req, res, next } = makeReqRes(null);
    requestId(req, res, next);
    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', req.id);
    expect(next).toHaveBeenCalled();
  });

  test('uses the provided X-Request-ID header value', () => {
    const { req, res, next } = makeReqRes('my-trace-id-12345');
    requestId(req, res, next);
    expect(req.id).toBe('my-trace-id-12345');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'my-trace-id-12345');
  });

  test('echoes ID in response header', () => {
    const { req, res } = makeReqRes('abc-123');
    requestId(req, res, jest.fn());
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'abc-123');
  });

  test('calls next() in all cases', () => {
    const { req, res, next } = makeReqRes(null);
    requestId(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

/**
 * requestId.js — Request/Correlation ID middleware
 *
 * Reads the X-Request-ID header from the incoming request (set by a load balancer
 * or upstream proxy) or generates a new UUID v4. Attaches it to req.id and echoes
 * it back in the response header so clients can correlate responses with logs.
 *
 * This must be registered BEFORE all route handlers so every log line in a
 * request's lifecycle can include the same ID.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Express middleware that reads or generates an X-Request-ID, attaches it to
 * req.id, and includes it in the response headers.
 */
function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || uuidv4();
  req.id = id;
  res.setHeader('X-Request-ID', id);
  next();
}

module.exports = { requestId };

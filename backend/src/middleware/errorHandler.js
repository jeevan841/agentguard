/**
 * Global Error Handler
 */
const Sentry = require('@sentry/node');

function errorHandler(err, req, res, next) {
  console.error('[Error]', { reqId: req.id, message: err.message, stack: err.stack?.split('\n')[1] });

  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: 'Conflict',
      message: 'A record with this value already exists',
      field: err.meta?.target,
    });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Not Found', message: 'Record not found' });
  }

  // Validation errors
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid request data',
      details: err.errors,
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Unauthorized', message: err.message });
  }

  // Default
  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : 'Internal server error';

  // P1#7 — Capture 5xx errors in Sentry, tagged with request ID for correlation
  if (status >= 500 && process.env.SENTRY_DSN) {
    Sentry.withScope((scope) => {
      scope.setTag('request_id', req?.id);
      scope.setTag('route', `${req?.method} ${req?.path}`);
      Sentry.captureException(err);
    });
  }

  res.status(status).json({ error: status < 500 ? 'Client Error' : 'Server Error', message });
}

/**
 * 404 handler
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
}

module.exports = { errorHandler, notFoundHandler };

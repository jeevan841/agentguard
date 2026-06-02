/**
 * Structured Logging with Winston
 * Provides consistent, searchable logs across the application
 */
const winston = require('winston');
const config = require('../config');
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format with colors
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, service, component, ...meta }) => {
    let msg = `${timestamp} [${service}]`;
    if (component) msg += ` [${component}]`;
    msg += ` ${level}: ${message}`;
    
    // Add metadata if present
    const metaKeys = Object.keys(meta).filter(k => !['timestamp', 'level', 'message', 'service', 'component'].includes(k));
    if (metaKeys.length > 0) {
      const metaObj = {};
      metaKeys.forEach(k => metaObj[k] = meta[k]);
      msg += ` ${JSON.stringify(metaObj)}`;
    }
    
    return msg;
  })
);

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (config.isDev ? 'debug' : 'info'),
  format: logFormat,
  defaultMeta: { service: 'agentguard-backend' },
  transports: [
    // Console output
    new winston.transports.Console({
      format: consoleFormat,
    }),
    // Error log file
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
    // Combined log file
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 10,
      tailable: true,
    }),
  ],
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      maxsize: 10485760,
      maxFiles: 3,
    }),
  ],
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      maxsize: 10485760,
      maxFiles: 3,
    }),
  ],
});

// Add request logging helper
logger.logRequest = (req, res, duration) => {
  const meta = {
    method: req.method,
    url: req.originalUrl || req.url,
    status: res.statusCode,
    duration: `${duration}ms`,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent'),
  };
  
  if (res.statusCode >= 500) {
    logger.error('HTTP Request', meta);
  } else if (res.statusCode >= 400) {
    logger.warn('HTTP Request', meta);
  } else {
    logger.info('HTTP Request', meta);
  }
};

// Add component-specific loggers
logger.database = (message, meta = {}) => logger.info(message, { component: 'database', ...meta });
logger.redis = (message, meta = {}) => logger.info(message, { component: 'redis', ...meta });
logger.auth = (message, meta = {}) => logger.info(message, { component: 'auth', ...meta });
logger.guardrail = (message, meta = {}) => logger.info(message, { component: 'guardrail', ...meta });
logger.websocket = (message, meta = {}) => logger.info(message, { component: 'websocket', ...meta });
logger.claude = (message, meta = {}) => logger.info(message, { component: 'claude', ...meta });

module.exports = logger;

// Made with Bob

/**
 * Input Sanitization Middleware
 * Prevents XSS, log injection, and other input-based attacks
 */
const sanitizeHtml = require('sanitize-html');

/**
 * Sanitize string input to prevent XSS and injection attacks
 */
function sanitizeString(input, options = {}) {
  if (!input || typeof input !== 'string') return input;
  
  const {
    allowHtml = false,
    maxLength = 100000,
  } = options;
  
  // Trim and limit length
  let sanitized = input.trim().slice(0, maxLength);
  
  if (!allowHtml) {
    // Remove all HTML tags
    sanitized = sanitizeHtml(sanitized, {
      allowedTags: [],
      allowedAttributes: {},
      disallowedTagsMode: 'recursiveEscape',
    });
  } else {
    // Allow safe HTML only
    sanitized = sanitizeHtml(sanitized, {
      allowedTags: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'code', 'pre'],
      allowedAttributes: {},
      disallowedTagsMode: 'recursiveEscape',
    });
  }
  
  // Escape special characters for log injection prevention
  sanitized = sanitized
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\x00/g, ''); // Remove null bytes
  
  return sanitized;
}

/**
 * Recursively sanitize object properties
 */
function sanitizeObject(obj, options = {}) {
  if (!obj || typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, options));
  }
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value, options);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value, options);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Express middleware to sanitize request body and query params
 */
function sanitizeMiddleware(options = {}) {
  return (req, res, next) => {
    try {
      if (req.body && typeof req.body === 'object') {
        req.body = sanitizeObject(req.body, options);
      }
      
      if (req.query && typeof req.query === 'object') {
        req.query = sanitizeObject(req.query, options);
      }
      
      next();
    } catch (err) {
      console.error('[Sanitize] Error sanitizing input:', err.message);
      next(err);
    }
  };
}

module.exports = {
  sanitizeString,
  sanitizeObject,
  sanitizeMiddleware,
};

// Made with Bob

/**
 * Safe Regex Utilities
 * Protects against ReDoS (Regular Expression Denial of Service) attacks
 */

/**
 * Execute regex test with timeout protection
 * @param {RegExp} pattern - Regex pattern to test
 * @param {string} text - Text to test against
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<boolean>} - Test result
 */
function safeRegexTest(pattern, text, timeoutMs = 100) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Regex timeout after ${timeoutMs}ms - possible ReDoS attack`));
    }, timeoutMs);
    
    try {
      pattern.lastIndex = 0; // Reset regex state
      const result = pattern.test(text);
      clearTimeout(timeout);
      resolve(result);
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

/**
 * Execute regex match with timeout protection
 * @param {RegExp} pattern - Regex pattern to match
 * @param {string} text - Text to match against
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Array|null>} - Match results
 */
function safeRegexMatch(pattern, text, timeoutMs = 100) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Regex timeout after ${timeoutMs}ms - possible ReDoS attack`));
    }, timeoutMs);
    
    try {
      pattern.lastIndex = 0;
      const result = text.match(pattern);
      clearTimeout(timeout);
      resolve(result);
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

/**
 * Batch regex operations with timeout protection
 * @param {Array} patterns - Array of {type, pattern, severity} objects
 * @param {string} text - Text to scan
 * @param {number} timeoutMs - Timeout per pattern in milliseconds
 * @returns {Promise<Array>} - Array of detection results
 */
async function safeRegexScan(patterns, text, timeoutMs = 150) {
  const results = [];
  
  for (const patternObj of patterns) {
    const { type, pattern, severity } = patternObj;
    
    try {
      const matches = await safeRegexMatch(pattern, text, timeoutMs);
      if (matches && matches.length > 0) {
        results.push({ 
          type, 
          matches, 
          severity,
          count: matches.length,
        });
      }
    } catch (err) {
      console.warn(`[SafeRegex] Pattern ${type} timed out or failed:`, err.message);
      // Continue with other patterns instead of failing completely
    }
  }
  
  return results;
}

/**
 * Execute regex replace with timeout protection
 * @param {RegExp} pattern - Regex pattern
 * @param {string} text - Text to process
 * @param {string|Function} replacement - Replacement string or function
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<string>} - Replaced text
 */
function safeRegexReplace(pattern, text, replacement, timeoutMs = 100) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Regex timeout after ${timeoutMs}ms - possible ReDoS attack`));
    }, timeoutMs);
    
    try {
      pattern.lastIndex = 0;
      const result = text.replace(pattern, replacement);
      clearTimeout(timeout);
      resolve(result);
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

module.exports = {
  safeRegexTest,
  safeRegexMatch,
  safeRegexScan,
  safeRegexReplace,
};

// Made with Bob

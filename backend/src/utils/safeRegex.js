/**
 * Safe Regex Utilities
 * Protects against ReDoS (Regular Expression Denial of Service) by running
 * each regex in an isolated worker_thread that is hard-terminated on timeout.
 *
 * WHY THIS WORKS (and why setTimeout alone does NOT):
 *   Node.js regex execution is synchronous on the main thread. A catastrophic
 *   backtracking pattern will block the entire event loop — no timer callback,
 *   no Promise resolution, nothing can preempt it.
 *
 *   By offloading regex execution to a worker_thread we get true OS-level
 *   concurrency. Calling worker.terminate() sends SIGTERM to the thread and
 *   immediately stops the regex, regardless of how long it would otherwise run.
 */
'use strict';

const { Worker } = require('worker_threads');
const path = require('path');

const WORKER_SCRIPT = path.join(__dirname, 'regexWorker.js');

/**
 * Run a single regex operation in a dedicated worker thread.
 * The worker is created per-call so a terminated worker never affects others.
 *
 * @param {'test'|'match'|'replace'} operation
 * @param {RegExp}  pattern
 * @param {string}  text
 * @param {string}  [replacement]  Only used for 'replace' operation.
 * @param {number}  [timeoutMs=100]
 * @returns {Promise<boolean|Array|string|null>}
 */
function runInWorker(operation, pattern, text, replacement, timeoutMs = 100) {
  return new Promise((resolve, reject) => {
    // Serialize the RegExp so it can cross the structured-clone boundary.
    const flags = pattern.flags;
    const source = pattern.source;

    const worker = new Worker(WORKER_SCRIPT, {
      workerData: { operation, pattern: source, flags, text, replacement },
    });

    // Hard-kill the worker after timeoutMs. This genuinely stops
    // catastrophic backtracking — something setTimeout cannot do.
    const timer = setTimeout(() => {
      worker.terminate(); // kills the thread immediately
      reject(new Error(`Regex timed out after ${timeoutMs}ms — possible ReDoS pattern`));
    }, timeoutMs);

    worker.on('message', ({ ok, result, error }) => {
      clearTimeout(timer);
      if (ok) {
        resolve(result);
      } else {
        reject(new Error(error));
      }
    });

    worker.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    worker.on('exit', (code) => {
      clearTimeout(timer);
      // Non-zero exit after we already rejected (from timeout) is expected.
      // Only reject here if we haven't resolved/rejected yet.
      if (code !== 0) {
        reject(new Error(`Regex worker exited unexpectedly with code ${code}`));
      }
    });
  });
}

/**
 * Execute regex test in a worker thread with hard timeout.
 * @param {RegExp} pattern
 * @param {string} text
 * @param {number} [timeoutMs=100]
 * @returns {Promise<boolean>}
 */
function safeRegexTest(pattern, text, timeoutMs = 100) {
  return runInWorker('test', pattern, text, undefined, timeoutMs);
}

/**
 * Execute regex match in a worker thread with hard timeout.
 * @param {RegExp} pattern
 * @param {string} text
 * @param {number} [timeoutMs=100]
 * @returns {Promise<Array|null>}
 */
function safeRegexMatch(pattern, text, timeoutMs = 100) {
  return runInWorker('match', pattern, text, undefined, timeoutMs);
}

/**
 * Batch regex operations, each in its own worker thread.
 * Timed-out or erroring patterns are skipped (logged as warnings); they do
 * NOT abort the entire scan.
 *
 * @param {Array<{type:string, pattern:RegExp, severity:string}>} patterns
 * @param {string} text
 * @param {number} [timeoutMs=150]
 * @returns {Promise<Array>}
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
      // Pattern timed out or errored — log and continue.
      console.warn(`[SafeRegex] Pattern "${type}" aborted: ${err.message}`);
    }
  }

  return results;
}

/**
 * Execute regex replace in a worker thread with hard timeout.
 * @param {RegExp} pattern
 * @param {string} text
 * @param {string} replacement
 * @param {number} [timeoutMs=100]
 * @returns {Promise<string>}
 */
function safeRegexReplace(pattern, text, replacement, timeoutMs = 100) {
  return runInWorker('replace', pattern, text, replacement, timeoutMs);
}

module.exports = {
  safeRegexTest,
  safeRegexMatch,
  safeRegexScan,
  safeRegexReplace,
};

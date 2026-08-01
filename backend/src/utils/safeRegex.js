/**
 * Safe Regex Utilities — Worker Pool Edition
 *
 * Protects against ReDoS (Regular Expression Denial of Service) by running
 * each regex operation in a worker thread from a persistent Piscina pool.
 *
 * WHY THIS WORKS (and why setTimeout alone does NOT):
 *   Node.js regex execution is synchronous on the main thread. A catastrophic
 *   backtracking pattern blocks the entire event loop — no timer callback,
 *   no Promise can preempt it.
 *
 *   By offloading to a worker_thread we get true OS-level concurrency.
 *   When a task times out, Piscina terminates the offending thread via an
 *   AbortController signal and replaces it with a fresh one — providing the
 *   same hard-kill guarantee as the previous per-call approach.
 *
 * WHY PISCINA (vs. spawn-per-call):
 *   Round 1 used a new Worker() per regex call. Spawning ~30 threads per
 *   guardrail check had a measured cost of ~400ms p95 and ~2.4 req/s throughput.
 *   A persistent pool of CPU-count threads eliminates spawn overhead while
 *   preserving the per-task hard-timeout-and-terminate guarantee.
 */
'use strict';

const Piscina = require('piscina');
const path = require('path');
const os = require('os');

// One pool shared for the lifetime of the process.
// Sized to available CPU cores (min 2) so it doesn't starve other work.
const pool = new Piscina({
  filename: path.join(__dirname, 'regexWorker.js'),
  minThreads: 1,
  maxThreads: Math.max(2, os.cpus().length),
  idleTimeout: 30000, // keep threads alive 30 s after their last task
});

/**
 * Run a single regex operation via the pool with a hard per-task timeout.
 * If the task exceeds timeoutMs, the worker thread is terminated and replaced.
 *
 * @param {'test'|'match'|'replace'} operation
 * @param {RegExp}  pattern
 * @param {string}  text
 * @param {string}  [replacement]  Only used for 'replace'.
 * @param {number}  [timeoutMs=200]
 * @returns {Promise<boolean|Array|string|null>}
 */
function runInPool(operation, pattern, text, replacement, timeoutMs = 200) {
  const controller = new AbortController();

  // Hard-kill the worker thread if it exceeds the timeout.
  // Piscina will terminate the thread and spawn a replacement automatically.
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const task = pool.run(
    {
      operation,
      pattern: pattern.source,
      flags: pattern.flags,
      text,
      replacement,
    },
    { signal: controller.signal }
  );

  return task
    .then((response) => {
      clearTimeout(timer);
      if (response.ok) return response.result;
      throw new Error(response.error);
    })
    .catch((err) => {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error(`Regex timed out after ${timeoutMs}ms — possible ReDoS pattern`);
      }
      throw err;
    });
}

/**
 * Execute regex test via pool with hard timeout.
 * @param {RegExp} pattern
 * @param {string} text
 * @param {number} [timeoutMs=200]
 * @returns {Promise<boolean>}
 */
function safeRegexTest(pattern, text, timeoutMs = 200) {
  return runInPool('test', pattern, text, undefined, timeoutMs);
}

/**
 * Execute regex match via pool with hard timeout.
 * @param {RegExp} pattern
 * @param {string} text
 * @param {number} [timeoutMs=200]
 * @returns {Promise<Array|null>}
 */
function safeRegexMatch(pattern, text, timeoutMs = 200) {
  return runInPool('match', pattern, text, undefined, timeoutMs);
}

/**
 * Batch regex scan — runs all patterns through the pool concurrently.
 * Timed-out or erroring patterns are skipped (logged); they do NOT abort
 * the rest of the scan.
 *
 * @param {Array<{type:string, pattern:RegExp, severity:string}>} patterns
 * @param {string} text
 * @param {number} [timeoutMs=200]
 * @returns {Promise<Array>}
 */
async function safeRegexScan(patterns, text, timeoutMs = 200) {
  // Run all patterns concurrently through the pool — the pool caps parallelism
  // to maxThreads automatically, so this won't spawn unlimited threads.
  const settled = await Promise.allSettled(
    patterns.map((p) => safeRegexMatch(p.pattern, text, timeoutMs).then((matches) => ({ p, matches })))
  );

  const results = [];
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      const { p, matches } = outcome.value;
      if (matches && matches.length > 0) {
        results.push({ type: p.type, matches, severity: p.severity, count: matches.length });
      }
    } else {
      // Find the corresponding pattern for logging (by index)
      const idx = settled.indexOf(outcome);
      const label = patterns[idx]?.type ?? '?';
      console.warn(`[SafeRegex] Pattern "${label}" aborted: ${outcome.reason?.message}`);
    }
  }
  return results;
}

/**
 * Execute regex replace via pool with hard timeout.
 * @param {RegExp} pattern
 * @param {string} text
 * @param {string} replacement
 * @param {number} [timeoutMs=200]
 * @returns {Promise<string>}
 */
function safeRegexReplace(pattern, text, replacement, timeoutMs = 200) {
  return runInPool('replace', pattern, text, replacement, timeoutMs);
}

module.exports = {
  safeRegexTest,
  safeRegexMatch,
  safeRegexScan,
  safeRegexReplace,
  // Expose pool for graceful shutdown and testing
  _pool: pool,
};

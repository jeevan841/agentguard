/**
 * regexWorker.js
 * Runs a single regex operation inside a worker thread.
 * The parent can call worker.terminate() to enforce a hard timeout,
 * giving genuine protection against catastrophic backtracking (ReDoS).
 *
 * workerData shape:
 *   { operation: 'test'|'match'|'replace', pattern: string, flags: string,
 *     text: string, replacement?: string }
 */
'use strict';

const { workerData, parentPort } = require('worker_threads');

try {
  const { operation, pattern, flags, text, replacement } = workerData;
  const re = new RegExp(pattern, flags);

  let result;
  switch (operation) {
    case 'test':
      re.lastIndex = 0;
      result = re.test(text);
      break;
    case 'match':
      re.lastIndex = 0;
      result = text.match(re);
      break;
    case 'replace':
      re.lastIndex = 0;
      result = text.replace(re, replacement);
      break;
    default:
      throw new Error(`Unknown regex operation: ${operation}`);
  }

  parentPort.postMessage({ ok: true, result });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message });
}

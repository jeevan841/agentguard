/**
 * regexWorker.js
 *
 * Piscina task handler — runs inside a persistent worker thread from the pool.
 * Receives one regex operation per call; the pool reuses threads across requests.
 *
 * Input shape (the argument passed by Piscina):
 *   { operation: 'test'|'match'|'replace', pattern: string, flags: string,
 *     text: string, replacement?: string }
 *
 * Returns:
 *   { ok: true, result: ... }  on success
 *   { ok: false, error: string }  on failure
 *
 * ReDoS protection note:
 *   Individual tasks are subject to a per-task timeout set in the pool config
 *   (Piscina abortSignal). When the signal fires, Piscina terminates the entire
 *   worker thread and replaces it with a fresh one — providing the same hard-kill
 *   guarantee as the previous per-call worker approach, but without spawning a
 *   new thread on every request.
 */
'use strict';

module.exports = function regexTask({ operation, pattern, flags, text, replacement }) {
  try {
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
        return { ok: false, error: `Unknown regex operation: ${operation}` };
    }

    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

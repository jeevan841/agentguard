/**
 * CircuitBreaker.js — Lightweight state-machine circuit breaker
 *
 * States:
 *   CLOSED     — normal operation, requests pass through
 *   OPEN       — tripped after N consecutive failures; requests fail fast
 *                (returns fallback immediately without calling the target)
 *   HALF_OPEN  — recovery probe; one request is allowed through to test
 *                if the downstream is healthy again
 *
 * Configurable options:
 *   failureThreshold  — consecutive failures before tripping OPEN (default 5)
 *   successThreshold  — consecutive successes in HALF_OPEN to close (default 2)
 *   timeout           — milliseconds to wait in OPEN before probing (default 30s)
 *   name              — label for log messages
 *
 * Usage:
 *   const cb = new CircuitBreaker({ name: 'claude-api', failureThreshold: 5 });
 *   const result = await cb.call(async () => await claudeClient.messages.create(...));
 *   // throws CircuitOpenError if the breaker is open
 */
'use strict';

class CircuitOpenError extends Error {
  constructor(name) {
    super(`Circuit breaker "${name}" is OPEN — downstream is unhealthy, using fallback`);
    this.name = 'CircuitOpenError';
    this.isCircuitOpen = true;
  }
}

const STATE = Object.freeze({ CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' });

class CircuitBreaker {
  constructor({
    name = 'unnamed',
    failureThreshold = 5,
    successThreshold = 2,
    timeout = 30_000,  // ms in OPEN before probing
  } = {}) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.successThreshold = successThreshold;
    this.timeout = timeout;

    this._state = STATE.CLOSED;
    this._failures = 0;
    this._successes = 0;
    this._openedAt = null;
  }

  get state() { return this._state; }

  /**
   * Execute `fn` through the circuit breaker.
   * @param {() => Promise<*>} fn  The async operation to protect
   * @returns {Promise<*>}
   * @throws {CircuitOpenError} when the breaker is OPEN
   */
  async call(fn) {
    if (this._state === STATE.OPEN) {
      // Check if enough time has elapsed to probe
      if (Date.now() - this._openedAt >= this.timeout) {
        this._state = STATE.HALF_OPEN;
        this._successes = 0;
        console.log(`[CircuitBreaker:${this.name}] → HALF_OPEN (probing)`);
      } else {
        throw new CircuitOpenError(this.name);
      }
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      throw err;
    }
  }

  _onSuccess() {
    this._failures = 0;
    if (this._state === STATE.HALF_OPEN) {
      this._successes += 1;
      if (this._successes >= this.successThreshold) {
        this._state = STATE.CLOSED;
        console.log(`[CircuitBreaker:${this.name}] → CLOSED (recovered)`);
      }
    }
  }

  _onFailure(err) {
    this._failures += 1;
    if (this._state === STATE.HALF_OPEN || this._failures >= this.failureThreshold) {
      this._state = STATE.OPEN;
      this._openedAt = Date.now();
      console.warn(
        `[CircuitBreaker:${this.name}] → OPEN after ${this._failures} failure(s). ` +
        `Will probe again in ${this.timeout / 1000}s. Last error: ${err.message}`
      );
    }
  }

  /** Reset to CLOSED (for testing or admin override). */
  reset() {
    this._state = STATE.CLOSED;
    this._failures = 0;
    this._successes = 0;
    this._openedAt = null;
  }
}

module.exports = { CircuitBreaker, CircuitOpenError, STATE };

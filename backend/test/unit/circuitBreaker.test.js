/**
 * test/unit/circuitBreaker.test.js — P2#10
 */
'use strict';

jest.setTimeout(10000);

const { CircuitBreaker, CircuitOpenError, STATE } = require('../../src/services/CircuitBreaker');

describe('CircuitBreaker — P2#10', () => {
  test('CLOSED state: successful call passes through', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    const result = await cb.call(async () => 'ok');
    expect(result).toBe('ok');
    expect(cb.state).toBe(STATE.CLOSED);
  });

  test('trips OPEN after failureThreshold consecutive failures', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, timeout: 1000 });
    const boom = async () => { throw new Error('downstream down'); };
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(boom)).rejects.toThrow('downstream down');
    }
    expect(cb.state).toBe(STATE.OPEN);
  });

  test('OPEN state: throws CircuitOpenError without calling fn', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, timeout: 60000 });
    await expect(cb.call(async () => { throw new Error('x'); })).rejects.toThrow();
    expect(cb.state).toBe(STATE.OPEN);

    const spy = jest.fn();
    await expect(cb.call(spy)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(spy).not.toHaveBeenCalled();
  });

  test('transitions OPEN → HALF_OPEN after timeout', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, timeout: 10 });
    await expect(cb.call(async () => { throw new Error('x'); })).rejects.toThrow();
    expect(cb.state).toBe(STATE.OPEN);

    await new Promise((r) => setTimeout(r, 20)); // wait for timeout
    // Next call should attempt in HALF_OPEN
    await expect(cb.call(async () => 'probe')).resolves.toBe('probe');
    // One success is not enough (successThreshold=2)
    expect(cb.state).toBe(STATE.HALF_OPEN);
  });

  test('HALF_OPEN → CLOSED after successThreshold successes', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, successThreshold: 2, timeout: 10 });
    await expect(cb.call(async () => { throw new Error('x'); })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    await cb.call(async () => 'ok1');
    await cb.call(async () => 'ok2');
    expect(cb.state).toBe(STATE.CLOSED);
  });

  test('reset() returns breaker to CLOSED from OPEN', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    await expect(cb.call(async () => { throw new Error('x'); })).rejects.toThrow();
    expect(cb.state).toBe(STATE.OPEN);
    cb.reset();
    expect(cb.state).toBe(STATE.CLOSED);
  });
});

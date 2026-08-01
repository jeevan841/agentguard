/**
 * test/unit/OtpStore.test.js
 *
 * Tests for Fix #5: per-account OTP/TOTP lockout
 *
 * Mocks Redis so no live Redis is needed.
 */
'use strict';

jest.setTimeout(10000);

// ─── Mock Redis client ────────────────────────────────────────────────────────
const mockStore = {};

const mockRedis = {
  get: jest.fn(async (key) => mockStore[key] ?? null),
  set: jest.fn(async (key, val, ...args) => { mockStore[key] = val; return 'OK'; }),
  incr: jest.fn(async (key) => {
    mockStore[key] = String((parseInt(mockStore[key] || '0', 10) + 1));
    return parseInt(mockStore[key], 10);
  }),
  expire: jest.fn(async () => 1),
  del: jest.fn(async (...keys) => {
    keys.flat().forEach((k) => delete mockStore[k]);
    return keys.flat().length;
  }),
};

jest.mock('../../src/redis/client', () => ({
  getRedis: () => mockRedis,
}));

// Fresh require after mock is registered
const {
  generateAndStoreOtp,
  verifyAndConsumeOtp,
  isAccountLocked,
  unlockAccount,
  MAX_FAILURES,
} = require('../../src/services/OtpStore');

// Reset store between tests
beforeEach(() => {
  Object.keys(mockStore).forEach((k) => delete mockStore[k]);
  jest.clearAllMocks();
});


// ─── Basic OTP correctness ────────────────────────────────────────────────────
describe('OTP basic correctness', () => {
  test('generates a 6-digit string OTP', async () => {
    const otp = await generateAndStoreOtp('user-1');
    expect(typeof otp).toBe('string');
    expect(otp).toMatch(/^\d{6}$/);
  });

  test('verifyAndConsumeOtp returns { valid: true } on correct code', async () => {
    const otp = await generateAndStoreOtp('user-2');
    const result = await verifyAndConsumeOtp('user-2', otp);
    expect(result.valid).toBe(true);
    expect(result.locked).toBe(false);
  });

  test('verifyAndConsumeOtp returns { valid: false } on wrong code', async () => {
    await generateAndStoreOtp('user-3');
    const result = await verifyAndConsumeOtp('user-3', '000000');
    expect(result.valid).toBe(false);
    expect(result.locked).toBe(false);
  });

  test('OTP is consumed on success (cannot be reused)', async () => {
    const otp = await generateAndStoreOtp('user-4');
    await verifyAndConsumeOtp('user-4', otp); // first use — OK
    const second = await verifyAndConsumeOtp('user-4', otp); // second use — should fail
    expect(second.valid).toBe(false);
  });
});

// ─── Fix #5: per-account lockout ─────────────────────────────────────────────
describe('Per-account OTP lockout — Fix #5', () => {
  test(`account locks after ${MAX_FAILURES} consecutive failures from any IP`, async () => {
    await generateAndStoreOtp('victim-user');

    // Simulate MAX_FAILURES wrong attempts coming from "different IPs" —
    // but the lockout is keyed by userId, not by IP, so IP doesn't matter here.
    for (let i = 0; i < MAX_FAILURES - 1; i++) {
      const result = await verifyAndConsumeOtp('victim-user', '000000');
      expect(result.valid).toBe(false);
      expect(result.locked).toBe(false);
      // Remaining attempts should count down
      expect(result.remainingAttempts).toBe(MAX_FAILURES - (i + 1));
    }

    // The MAX_FAILURES-th failure should trigger lockout
    const lockResult = await verifyAndConsumeOtp('victim-user', '000000');
    expect(lockResult.locked).toBe(true);
    expect(lockResult.valid).toBe(false);
  });

  test('locked account rejects even a correct OTP', async () => {
    // Force-lock the account by setting the sentinel directly
    mockStore['otp:locked:locked-user'] = '1';

    const otp = await generateAndStoreOtp('locked-user');
    const result = await verifyAndConsumeOtp('locked-user', otp);
    expect(result.locked).toBe(true);
    expect(result.valid).toBe(false);
  });

  test('isAccountLocked returns true when locked sentinel is set', async () => {
    mockStore['otp:locked:chk-user'] = '1';
    expect(await isAccountLocked('chk-user')).toBe(true);
  });

  test('isAccountLocked returns false for a clean account', async () => {
    expect(await isAccountLocked('clean-user')).toBe(false);
  });

  test('unlockAccount clears lockout and failure counter', async () => {
    mockStore['otp:locked:unlock-user'] = '1';
    mockStore['otp:fail:unlock-user'] = '5';

    await unlockAccount('unlock-user');

    expect(await isAccountLocked('unlock-user')).toBe(false);
  });

  test('successful OTP resets failure counter', async () => {
    // Two failures followed by a correct code — failure counter must be cleared
    await generateAndStoreOtp('reset-user');
    await verifyAndConsumeOtp('reset-user', '000000'); // fail
    await verifyAndConsumeOtp('reset-user', '000000'); // fail again

    const otp = await generateAndStoreOtp('reset-user'); // issue a fresh OTP
    const result = await verifyAndConsumeOtp('reset-user', otp); // correct
    expect(result.valid).toBe(true);

    // Counter key must be gone
    expect(mockStore['otp:fail:reset-user']).toBeUndefined();
  });
});

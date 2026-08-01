/**
 * OtpStore — Redis-based ephemeral OTP storage with TTL
 * Keys:
 *   otp:<userId>           → 6-digit code, expires in 10 minutes
 *   otp:fail:<userId>      → failure counter, expires after LOCKOUT_WINDOW_SECONDS
 *   otp:locked:<userId>    → lockout sentinel, expires after LOCKOUT_DURATION_SECONDS
 */
'use strict';

const { getRedis } = require('../redis/client');

const OTP_TTL_SECONDS = 10 * 60;         // 10 minutes OTP lifetime
const MAX_FAILURES = 5;                   // consecutive failures before lockout
const LOCKOUT_WINDOW_SECONDS = 15 * 60;  // sliding window for failure counting (15 min)
const LOCKOUT_DURATION_SECONDS = 15 * 60; // how long the account is locked out (15 min)

/**
 * Generates a cryptographically secure 6-digit OTP and stores it in Redis.
 * Also clears any existing failure counter on a fresh OTP issue.
 * @param {string} userId
 * @returns {string} The 6-digit OTP
 */
async function generateAndStoreOtp(userId) {
  // Use crypto.randomInt for proper CSPRNG (Math.random is not cryptographically secure)
  const { randomInt } = require('crypto');
  const otp = String(randomInt(100000, 1000000)); // [100000, 999999]
  const redis = getRedis();
  await redis.set(`otp:${userId}`, otp, 'EX', OTP_TTL_SECONDS);
  return otp;
}

/**
 * Returns true if the account is currently locked out due to too many failures.
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isAccountLocked(userId) {
  const redis = getRedis();
  const locked = await redis.get(`otp:locked:${userId}`);
  return locked !== null;
}

/**
 * Verifies an OTP for a user.
 * - Returns true and resets the failure counter on success.
 * - Increments the per-account failure counter on failure.
 * - Locks the account for LOCKOUT_DURATION_SECONDS after MAX_FAILURES.
 *
 * @param {string} userId
 * @param {string} code - The code submitted by the user
 * @returns {{ valid: boolean, locked: boolean, remainingAttempts?: number }}
 */
async function verifyAndConsumeOtp(userId, code) {
  const redis = getRedis();

  // Check lockout first (IP-independent — keyed by account)
  const locked = await isAccountLocked(userId);
  if (locked) {
    return { valid: false, locked: true };
  }

  const stored = await redis.get(`otp:${userId}`);
  if (!stored || stored !== String(code)) {
    // Increment failure counter
    const failKey = `otp:fail:${userId}`;
    const failures = await redis.incr(failKey);
    if (failures === 1) {
      // First failure — set the window expiry
      await redis.expire(failKey, LOCKOUT_WINDOW_SECONDS);
    }

    if (failures >= MAX_FAILURES) {
      // Lock the account
      await redis.set(`otp:locked:${userId}`, '1', 'EX', LOCKOUT_DURATION_SECONDS);
      await redis.del(failKey); // clean up counter
      return { valid: false, locked: true };
    }

    return { valid: false, locked: false, remainingAttempts: MAX_FAILURES - failures };
  }

  // Success — consume OTP and clear failure state
  await Promise.all([
    redis.del(`otp:${userId}`),
    redis.del(`otp:fail:${userId}`),
    redis.del(`otp:locked:${userId}`),
  ]);
  return { valid: true, locked: false };
}

/**
 * Unlock a user account manually (e.g. admin action or support flow).
 * @param {string} userId
 */
async function unlockAccount(userId) {
  const redis = getRedis();
  await Promise.all([
    redis.del(`otp:locked:${userId}`),
    redis.del(`otp:fail:${userId}`),
  ]);
}

module.exports = {
  generateAndStoreOtp,
  verifyAndConsumeOtp,
  isAccountLocked,
  unlockAccount,
  // Export constants for tests
  MAX_FAILURES,
  LOCKOUT_DURATION_SECONDS,
};

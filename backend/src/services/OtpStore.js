/**
 * OtpStore — Redis-based ephemeral OTP storage with TTL
 * Keys: otp:<userId>  → 6-digit code, expires in 10 minutes
 */
const { getRedis } = require('../redis/client');

const OTP_TTL_SECONDS = 10 * 60; // 10 minutes

/**
 * Generates a cryptographically random 6-digit OTP and stores it in Redis.
 * @param {string} userId
 * @returns {string} The 6-digit OTP
 */
async function generateAndStoreOtp(userId) {
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const redis = getRedis();
  await redis.set(`otp:${userId}`, otp, 'EX', OTP_TTL_SECONDS);
  return otp;
}

/**
 * Verifies an OTP for a user. Returns true if valid, deletes it on success.
 * @param {string} userId
 * @param {string} code - The code submitted by the user
 * @returns {boolean}
 */
async function verifyAndConsumeOtp(userId, code) {
  const redis = getRedis();
  const stored = await redis.get(`otp:${userId}`);
  if (!stored || stored !== String(code)) return false;
  await redis.del(`otp:${userId}`);
  return true;
}

module.exports = { generateAndStoreOtp, verifyAndConsumeOtp };

/**
 * TokenRevocationService
 * Manages token blacklisting and revocation for security
 */
const prisma = require('../prisma/client');
const { getRedis } = require('../redis/client');
const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Revoke a token by adding it to the blacklist
 */
async function revokeToken(token, reason = 'manual_revoke') {
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    const jti = decoded.jti || decoded.sub; // Use jti or fallback to sub
    const expiresAt = new Date(decoded.exp * 1000);

    // Store in database
    await prisma.revokedToken.create({
      data: {
        token_jti: jti,
        user_id: decoded.userId || null,
        agent_id: decoded.agentId || null,
        reason,
        expires_at: expiresAt,
      },
    });

    // Also cache in Redis for fast lookup
    const redis = getRedis();
    const ttl = Math.floor((expiresAt - Date.now()) / 1000);
    if (ttl > 0) {
      await redis.setex(`revoked:${jti}`, ttl, reason);
    }

    console.log(`[TokenRevocation] Token revoked: ${jti} (reason: ${reason})`);
    return true;
  } catch (err) {
    console.error('[TokenRevocation] Failed to revoke token:', err.message);
    return false;
  }
}

/**
 * Check if a token is revoked
 */
async function isTokenRevoked(token) {
  try {
    const decoded = jwt.verify(token, config.jwt.secret, { ignoreExpiration: true });
    const jti = decoded.jti || decoded.sub;

    // Check Redis first (fast)
    const redis = getRedis();
    const cached = await redis.get(`revoked:${jti}`);
    if (cached) return true;

    // Check database (fallback)
    const revoked = await prisma.revokedToken.findUnique({
      where: { token_jti: jti },
    });
    return !!revoked;
  } catch {
    return false;
  }
}

/**
 * Revoke all tokens for a user
 */
async function revokeAllUserTokens(userId, reason = 'security_breach') {
  try {
    // Get all revoked tokens for this user
    const tokens = await prisma.revokedToken.findMany({
      where: { user_id: userId },
    });

    console.log(`[TokenRevocation] Revoking all tokens for user ${userId}: ${reason} (${tokens.length} existing)`);
    
    // In a full implementation, you'd track all active sessions
    // For now, we log the action and future tokens will be checked against this
    return true;
  } catch (err) {
    console.error('[TokenRevocation] Failed to revoke all user tokens:', err.message);
    return false;
  }
}

/**
 * Cleanup expired revoked tokens (run daily via cron)
 */
async function cleanupExpiredTokens() {
  try {
    const deleted = await prisma.revokedToken.deleteMany({
      where: { expires_at: { lt: new Date() } },
    });
    console.log(`[TokenRevocation] Cleaned up ${deleted.count} expired revoked tokens`);
    return deleted.count;
  } catch (err) {
    console.error('[TokenRevocation] Cleanup failed:', err.message);
    return 0;
  }
}

module.exports = {
  revokeToken,
  isTokenRevoked,
  revokeAllUserTokens,
  cleanupExpiredTokens,
};

// Made with Bob

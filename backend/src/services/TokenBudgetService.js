/**
 * TokenBudgetService.js
 *
 * Tracks per-agent Claude API token usage in a rolling 30-day window via Redis.
 *
 * Design decisions:
 *   - Storage: Redis (already a dependency, no schema migration needed)
 *   - Window: rolling 30-day, reset by TTL (not calendar-month)
 *     Rationale: simpler for metered billing, fair across partial months,
 *     and stateless across process restarts.
 *   - Key: `tokens:usage:<agentId>` — a simple string counter
 *   - TTL: 30 days from the last increment (sliding window)
 *     This means: if an agent doesn't make any calls for 30 days, its counter
 *     resets automatically. To use a fixed window, replace GETEX with a
 *     dedicated expiry set once on first write.
 *
 * Enforcement:
 *   - checkBudget() is called BEFORE Claude API calls in client.js
 *   - incrementUsage() is called AFTER a successful Claude response, with the
 *     actual tokens used (not estimated).
 */
'use strict';

const { getRedis } = require('../redis/client');

const WINDOW_SECONDS = 30 * 24 * 60 * 60; // 30 days in seconds
const REDIS_KEY_PREFIX = 'tokens:usage:';

/**
 * Returns the current rolling-30-day token usage for an agent.
 * @param {string} agentId
 * @returns {Promise<number>} tokens used in the current window
 */
async function getUsage(agentId) {
  const redis = getRedis();
  const val = await redis.get(`${REDIS_KEY_PREFIX}${agentId}`);
  return val ? parseInt(val, 10) : 0;
}

/**
 * Increments the agent's token usage counter by `tokens`.
 * Resets the TTL to 30 days from now (sliding window).
 *
 * @param {string} agentId
 * @param {number} tokens  Actual tokens used in this request (from API response)
 * @returns {Promise<number>} New cumulative total
 */
async function incrementUsage(agentId, tokens) {
  if (!agentId || !tokens || tokens <= 0) return getUsage(agentId);
  const redis = getRedis();
  const key = `${REDIS_KEY_PREFIX}${agentId}`;

  // INCRBY + EXPIRE in a pipeline for atomicity
  const [newVal] = await redis.pipeline()
    .incrby(key, tokens)
    .expire(key, WINDOW_SECONDS)
    .exec();

  return newVal?.[1] ?? tokens;
}

/**
 * Checks whether a proposed Claude API call would exceed the agent's budget.
 *
 * @param {object} agent  Agent record (must have id and max_token_budget)
 * @param {number} [estimatedTokens=1024]  Estimated tokens for this request
 * @returns {Promise<{allowed: boolean, used: number, budget: number, remaining: number}>}
 */
async function checkBudget(agent, estimatedTokens = 1024) {
  if (!agent?.max_token_budget) {
    // No budget set — allow everything (backwards compatible)
    return { allowed: true, used: 0, budget: null, remaining: null };
  }

  const used = await getUsage(agent.id);
  const budget = agent.max_token_budget;
  const remaining = Math.max(0, budget - used);
  const allowed = remaining >= estimatedTokens;

  return { allowed, used, budget, remaining };
}

/**
 * Resets the usage counter for an agent (admin/billing use).
 * @param {string} agentId
 */
async function resetUsage(agentId) {
  const redis = getRedis();
  await redis.del(`${REDIS_KEY_PREFIX}${agentId}`);
}

module.exports = { getUsage, incrementUsage, checkBudget, resetUsage };

/**
 * claude/client.js
 *
 * Claude API client with:
 *   - Token budget enforcement (P0#2) — checks agent budget before calling;
 *     increments actual usage after a successful response
 *   - Circuit breaker (P2#10) — trips after 5 consecutive failures, probes
 *     after 30s, returns rule-based fallback while open
 *   - Retry with exponential backoff — 3 attempts (50ms → 200ms → 800ms)
 *     before counting as a circuit failure
 */
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const { checkBudget, incrementUsage } = require('../services/TokenBudgetService');
const { CircuitBreaker, CircuitOpenError } = require('../services/CircuitBreaker');

// One circuit breaker for the Claude API, shared for the process lifetime.
const claudeBreaker = new CircuitBreaker({
  name: 'claude-api',
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30_000,
});

let client = null;

function getClaudeClient() {
  if (!client && config.hasClaudeKey) {
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}

/** Structured fallback returned whenever Claude is unavailable. */
const FALLBACK_RESPONSE = JSON.stringify({
  fallback: true,
  message: 'Claude API not configured or unavailable — rule-based analysis used instead',
});

/**
 * Exponential backoff retry wrapper.
 * @param {() => Promise<*>} fn
 * @param {number} maxAttempts
 * @returns {Promise<*>}
 */
async function withRetry(fn, maxAttempts = 3) {
  let lastErr;
  const delays = [50, 200, 800];
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, delays[i]));
      }
    }
  }
  throw lastErr;
}

/**
 * Make a Claude API call with budget enforcement, circuit breaker, and retry.
 *
 * @param {string} prompt         User message
 * @param {string} systemPrompt   System instructions
 * @param {number} maxTokens      Max output tokens (also used as budget estimate)
 * @param {object} [agentCtx]     Optional { agentId, maxTokenBudget } for budget tracking
 * @returns {Promise<string>}     Response text, or fallback JSON on unavailability
 */
async function claudeComplete(prompt, systemPrompt = '', maxTokens = 1024, agentCtx = null) {
  const claude = getClaudeClient();

  if (!claude) return FALLBACK_RESPONSE;

  // ── P0#2: Token budget check ────────────────────────────────────────────────
  if (agentCtx?.agentId) {
    const budget = await checkBudget(
      { id: agentCtx.agentId, max_token_budget: agentCtx.maxTokenBudget },
      maxTokens
    );
    if (!budget.allowed) {
      console.warn(
        `[Claude] Agent ${agentCtx.agentId} token budget exceeded: ` +
        `used=${budget.used}/${budget.budget} remaining=${budget.remaining}`
      );
      return JSON.stringify({
        fallback: true,
        message: 'Token budget exceeded for this agent',
        budget: { used: budget.used, limit: budget.budget, remaining: budget.remaining },
      });
    }
  }

  // ── P2#10: Circuit breaker wraps the retry loop ────────────────────────────
  try {
    const response = await claudeBreaker.call(() =>
      withRetry(async () => {
        const res = await claude.messages.create({
          model: config.anthropic.model,
          max_tokens: maxTokens,
          system: systemPrompt || 'You are an AI security analysis assistant for AgentGuard.',
          messages: [{ role: 'user', content: prompt }],
        });

        // ── P0#2: Increment actual token usage after success ─────────────────
        if (agentCtx?.agentId) {
          const tokensUsed = (res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0);
          await incrementUsage(agentCtx.agentId, tokensUsed).catch(() => {});
        }

        return res.content[0]?.text || '';
      }, 3)
    );
    return response;
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      console.warn('[Claude] Circuit open — returning fallback');
      return FALLBACK_RESPONSE;
    }
    console.error('[Claude] API error after retries:', err.message);
    return FALLBACK_RESPONSE;
  }
}

module.exports = { getClaudeClient, claudeComplete, claudeBreaker };

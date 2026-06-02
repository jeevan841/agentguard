/**
 * GuardrailService
 * Orchestrates all guardrail checks: PII, Injection, Output Validation
 * Also computes hallucination score via Claude self-evaluation
 */
const { detectPII } = require('./PIIDetector');
const { detectInjection } = require('./InjectionDetector');
const { validateOutput } = require('./OutputValidator');
const { claudeComplete } = require('../../claude/client');
const { getRedis } = require('../../redis/client');
const prisma = require('../../prisma/client');

/**
 * Evaluate hallucination score using Claude self-eval
 * Returns a score from 0 (no hallucination) to 1 (high hallucination risk)
 */
async function evaluateHallucination(input, output, context = '') {
  if (!output) return { score: 0, reasoning: 'No output to evaluate' };

  const systemPrompt = `You are a hallucination detection system. Evaluate whether an AI response contains 
hallucinated information — claims that are not supported by the provided context or are factually incorrect.

Return ONLY a JSON object:
{
  "hallucination_score": number (0.0-1.0, where 0=no hallucination, 1=severe hallucination),
  "confidence": number (0-1),
  "issues": [string],
  "reasoning": string
}`;

  const prompt = `Input: "${input.slice(0, 500)}"
Context: "${(context || 'No context provided').slice(0, 800)}"
AI Response: "${output.slice(0, 800)}"

Rate the hallucination risk of the AI Response.`;

  try {
    const response = await claudeComplete(prompt, systemPrompt, 256);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        score: Math.max(0, Math.min(1, result.hallucination_score || 0)),
        confidence: result.confidence || 0.8,
        issues: result.issues || [],
        reasoning: result.reasoning || '',
      };
    }
  } catch (err) {
    console.warn('[Guardrail] Hallucination eval failed:', err.message);
  }

  // Fallback: simple heuristic
  const uncertaintyPhrases = [
    'i think', 'i believe', 'probably', 'might be', 'could be',
    'i\'m not sure', 'i\'m uncertain', 'approximately', 'around',
  ];
  const lowerOutput = output.toLowerCase();
  const uncertaintyCount = uncertaintyPhrases.filter((p) => lowerOutput.includes(p)).length;
  return {
    score: Math.min(0.8, uncertaintyCount * 0.15),
    confidence: 0.5,
    issues: [],
    reasoning: 'Fallback heuristic: counted uncertainty phrases',
  };
}

/**
 * Get policy rules from DB or use defaults
 */
async function getPolicyRules(policyId) {
  if (!policyId) {
    return {
      check_pii: true,
      check_injection: true,
      check_output: true,
      blocklist: [],
      restricted_topics: [],
      output_schema: null,
    };
  }

  try {
    const policy = await prisma.policy.findUnique({ where: { id: policyId } });
    if (policy && policy.rules) {
      return {
        check_pii: true,
        check_injection: true,
        check_output: true,
        ...policy.rules,
      };
    }
  } catch (err) {
    console.warn('[Guardrail] Could not fetch policy:', err.message);
  }

  return {
    check_pii: true,
    check_injection: true,
    check_output: true,
    blocklist: [],
    restricted_topics: [],
  };
}

/**
 * Track metrics in Redis
 */
async function trackMetrics(results, startTime) {
  try {
    const redis = getRedis();
    const latency = Date.now() - startTime;
    const timestamp = Math.floor(Date.now() / 60000); // minute bucket

    // Increment requests per minute
    await redis.incr(`metrics:requests:${timestamp}`);
    await redis.expire(`metrics:requests:${timestamp}`, 120);

    // Track latency
    await redis.lpush('metrics:latency', latency);
    await redis.ltrim('metrics:latency', 0, 999);

    // Track violations
    const violations = results.checks.filter((c) => !c.passed);
    for (const v of violations) {
      if (v.violation_type) {
        await redis.incr(`metrics:violations:${v.violation_type}`);
        await redis.incr(`metrics:violations:${v.violation_type}:${timestamp}`);
        await redis.expire(`metrics:violations:${v.violation_type}:${timestamp}`, 120);
      }
    }

    // Track overall pass/fail
    const passed = results.passed;
    await redis.incr(passed ? 'metrics:guardrail:passed' : 'metrics:guardrail:failed');

    // Publish event for WebSocket subscribers
    await redis.publish(
      'guardrail:events',
      JSON.stringify({
        type: 'guardrail_check',
        passed,
        latency,
        violations: violations.map((v) => v.violation_type),
        timestamp: new Date().toISOString(),
      })
    );
  } catch (err) {
    console.warn('[Metrics] Failed to track metrics:', err.message);
  }
}

/**
 * Main guardrail check function
 * @param {string} input - User/agent input
 * @param {string} output - LLM output (optional, for output validation)
 * @param {string} context - Retrieved context (for hallucination eval)
 * @param {string} policyId - Policy ID for custom rules
 */
async function runGuardrailChecks(input, output = null, context = '', policyId = null) {
  const startTime = Date.now();
  const rules = await getPolicyRules(policyId);

  const checks = [];
  const promises = [];

  // ── 1. PII Detection on input ───────────────────────────────────────────────
  if (rules.check_pii !== false) {
    promises.push(
      detectPII(input).then((result) => {
        checks.push({ check: 'pii_input', label: 'PII Detection (Input)', ...result });
      })
    );
  }

  // ── 2. PII Detection on output ─────────────────────────────────────────────
  if (output && rules.check_pii !== false) {
    promises.push(
      detectPII(output).then((result) => {
        checks.push({ check: 'pii_output', label: 'PII Detection (Output)', ...result });
      })
    );
  }

  // ── 3. Injection Detection ─────────────────────────────────────────────────
  if (rules.check_injection !== false) {
    promises.push(
      detectInjection(input).then((result) => {
        checks.push({ check: 'injection', label: 'Prompt Injection Detection', ...result });
      })
    );
  }

  // ── 4. Output Validation ───────────────────────────────────────────────────
  if (output && rules.check_output !== false) {
    promises.push(
      validateOutput(output, rules).then((result) => {
        checks.push({ check: 'output_validation', label: 'Output Validation', ...result });
      })
    );
  }

  // ── 5. Hallucination Evaluation ───────────────────────────────────────────
  let hallucinationResult = null;
  if (output) {
    promises.push(
      evaluateHallucination(input, output, context).then((result) => {
        hallucinationResult = result;
      })
    );
  }

  await Promise.all(promises);

  // ── Compute overall result ─────────────────────────────────────────────────
  const failedChecks = checks.filter((c) => !c.passed);
  const passed = failedChecks.length === 0;
  const latency = Date.now() - startTime;

  // Determine highest severity
  const severityOrder = { critical: 4, high: 3, medium: 2, low: 1, null: 0 };
  const highestSeverity = checks.reduce((max, c) => {
    const cSev = severityOrder[c.severity] || 0;
    return cSev > (severityOrder[max] || 0) ? c.severity : max;
  }, null);

  const results = {
    passed,
    overall_confidence: checks.length
      ? checks.reduce((sum, c) => sum + (c.confidence || 0), 0) / checks.length
      : 1.0,
    checks,
    failed_checks: failedChecks,
    violation_summary: failedChecks.map((c) => c.violation_type).filter(Boolean),
    severity: highestSeverity,
    hallucination_score: hallucinationResult?.score || null,
    hallucination_reasoning: hallucinationResult?.reasoning || null,
    latency_ms: latency,
  };

  // ── Track metrics asynchronously ──────────────────────────────────────────
  trackMetrics(results, startTime).catch(() => {});

  return results;
}

module.exports = { runGuardrailChecks, evaluateHallucination };

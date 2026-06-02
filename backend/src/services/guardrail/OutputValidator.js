/**
 * Output Validator
 * Validates LLM outputs against configurable business rules:
 * - JSON schema validation
 * - Keyword blocklist
 * - Topic restrictions
 * - Length limits
 */

/**
 * Default blocklist — words/phrases that should never appear in outputs
 */
const DEFAULT_BLOCKLIST = [
  // Violence / harmful content
  'bomb making', 'how to kill', 'instructions to harm',
  // Competitor mentions (configurable)
  // Legal issues
  'i am not a lawyer but', 'guaranteed returns', 'insider information',
];

/**
 * Validate output against a keyword blocklist
 */
function checkBlocklist(text, blocklist = []) {
  const combined = [...DEFAULT_BLOCKLIST, ...blocklist];
  const violations = [];

  for (const keyword of combined) {
    const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (regex.test(text)) {
      violations.push(keyword);
    }
  }

  return violations;
}

/**
 * Validate output against topic restrictions
 */
function checkTopicRestrictions(text, restrictedTopics = []) {
  const violations = [];
  const lowerText = text.toLowerCase();

  for (const topic of restrictedTopics) {
    const topicPatterns = {
      politics: /\b(?:democrat|republican|election|vote|biden|trump|political\s+party)\b/i,
      religion: /\b(?:christian|muslim|jewish|hindu|buddhist|atheist|god|allah|jesus|prophet)\b/i,
      medical_advice: /\b(?:you\s+should\s+take|prescribe|diagnose|cure\s+(?:your|the))\b/i,
      legal_advice: /\b(?:you\s+are\s+legally|legally\s+required|sue\s+(?:them|him|her))\b/i,
      financial_advice: /\b(?:buy\s+(?:stock|shares|bitcoin)|guaranteed\s+(?:return|profit))\b/i,
      adult_content: /\b(?:explicit|xxx|adult\s+content|nsfw)\b/i,
    };

    const pattern = topicPatterns[topic.toLowerCase()];
    if (pattern && pattern.test(lowerText)) {
      violations.push(topic);
    }
  }

  return violations;
}

/**
 * Validate output against a JSON schema (basic validation)
 */
function checkJSONSchema(text, schema) {
  if (!schema) return { valid: true };

  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!jsonMatch) {
    if (schema.required) {
      return { valid: false, reason: 'Expected JSON output but none found' };
    }
    return { valid: true };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in parsed)) {
          return { valid: false, reason: `Missing required field: ${field}` };
        }
      }
    }

    // Check field types
    if (schema.properties) {
      for (const [field, def] of Object.entries(schema.properties)) {
        if (field in parsed && def.type) {
          const actualType = Array.isArray(parsed[field]) ? 'array' : typeof parsed[field];
          if (actualType !== def.type) {
            return {
              valid: false,
              reason: `Field "${field}" expected ${def.type}, got ${actualType}`,
            };
          }
        }
      }
    }

    return { valid: true };
  } catch (e) {
    return { valid: false, reason: `JSON parse error: ${e.message}` };
  }
}

/**
 * Check output length constraints
 */
function checkLength(text, rules) {
  if (rules.max_length && text.length > rules.max_length) {
    return { passed: false, reason: `Output exceeds max length: ${text.length} > ${rules.max_length}` };
  }
  if (rules.min_length && text.length < rules.min_length) {
    return { passed: false, reason: `Output below min length: ${text.length} < ${rules.min_length}` };
  }
  return { passed: true };
}

/**
 * Main output validation function
 * @param {string} output - LLM output to validate
 * @param {Object} rules - Policy rules
 */
async function validateOutput(output, rules = {}) {
  if (!output || typeof output !== 'string') {
    return { passed: true, reason: 'No output to validate', confidence: 1.0, violations: [] };
  }

  const violations = [];

  // 1. Blocklist check
  const blocklistViolations = checkBlocklist(output, rules.blocklist || []);
  if (blocklistViolations.length > 0) {
    violations.push({
      type: 'blocklist',
      details: blocklistViolations,
      severity: 'high',
    });
  }

  // 2. Topic restriction check
  const topicViolations = checkTopicRestrictions(output, rules.restricted_topics || []);
  if (topicViolations.length > 0) {
    violations.push({
      type: 'topic_restriction',
      details: topicViolations,
      severity: 'medium',
    });
  }

  // 3. JSON schema check
  if (rules.output_schema) {
    const schemaResult = checkJSONSchema(output, rules.output_schema);
    if (!schemaResult.valid) {
      violations.push({
        type: 'schema_violation',
        details: schemaResult.reason,
        severity: 'medium',
      });
    }
  }

  // 4. Length check
  const lengthResult = checkLength(output, rules);
  if (!lengthResult.passed) {
    violations.push({
      type: 'length_violation',
      details: lengthResult.reason,
      severity: 'low',
    });
  }

  const passed = violations.length === 0;
  const criticalViolations = violations.filter((v) => v.severity === 'high');

  return {
    passed,
    reason: passed
      ? 'Output passed all validation checks'
      : `Output validation failed: ${violations.map((v) => v.type).join(', ')}`,
    confidence: passed ? 0.95 : 0.98,
    violations,
    violation_type: passed ? null : 'output',
    severity: criticalViolations.length > 0 ? 'high' : violations.length > 0 ? 'medium' : null,
  };
}

module.exports = { validateOutput };

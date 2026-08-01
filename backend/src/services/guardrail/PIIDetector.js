/**
 * PII Detector
 * Detects Personally Identifiable Information using regex patterns + Claude NER
 */
const { claudeComplete } = require('../../claude/client');
const { safeRegexScan } = require('../../utils/safeRegex');

// ─── Regex Patterns ────────────────────────────────────────────────────────────
const PII_PATTERNS = [
  {
    type: 'SSN',
    pattern: /\b(?!000|666|9\d{2})\d{3}[-\s]?(?!00)\d{2}[-\s]?(?!0{4})\d{4}\b/g,
    severity: 'critical',
  },
  {
    type: 'CREDIT_CARD',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|[25][1-7][0-9]{14}|6(?:011|5[0-9][0-9])[0-9]{12}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|(?:2131|1800|35\d{3})\d{11})\b/g,
    severity: 'critical',
  },
  {
    type: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
    severity: 'medium',
  },
  {
    type: 'PHONE',
    pattern: /\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
    severity: 'medium',
  },
  {
    type: 'IP_ADDRESS',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    severity: 'low',
  },
  {
    type: 'DATE_OF_BIRTH',
    pattern: /\b(?:DOB|date of birth|born on|birthday)[:\s]+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/gi,
    severity: 'high',
  },
  {
    type: 'PASSPORT',
    pattern: /\b[A-Z]{1,2}[0-9]{6,9}\b/g,
    severity: 'critical',
  },
  {
    type: 'DRIVER_LICENSE',
    pattern: /\b(?:DL|driver'?s?\s+license|license\s+#?)[:\s]*[A-Z0-9]{5,15}\b/gi,
    severity: 'high',
  },
  {
    type: 'BANK_ACCOUNT',
    pattern: /\b(?:account\s+(?:#|number|no)[:\s]*)?[0-9]{8,17}\b/gi,
    severity: 'critical',
  },
];

/**
 * Run regex-based PII detection on text with ReDoS protection
 */
async function regexScan(text) {
  const detections = [];

  try {
    // Use safe regex scan with timeout protection
    const results = await safeRegexScan(PII_PATTERNS, text, 150);
    
    for (const { type, matches, severity, count } of results) {
      detections.push({
        type,
        count,
        severity,
        samples: matches.slice(0, 2).map((m) =>
          m.replace(/./g, '*').slice(0, -4) + m.slice(-4)
        ),
      });
    }
  } catch (err) {
    console.error('[PII] Regex scan failed:', err.message);
    // Return empty detections on catastrophic failure
  }

  return detections;
}

/**
 * Use Claude to perform NER-based PII detection (richer, context-aware)
 */
async function claudeNERScan(text) {
  const systemPrompt = `You are a PII detection system. Analyze text for personally identifiable information.
Return ONLY a JSON object with this exact structure:
{
  "has_pii": boolean,
  "entities": [{ "type": string, "severity": "low"|"medium"|"high"|"critical", "count": number }],
  "confidence": number (0-1),
  "reasoning": string
}
Types to detect: NAME, ADDRESS, SSN, CREDIT_CARD, EMAIL, PHONE, BANK_ACCOUNT, MEDICAL_RECORD, 
DATE_OF_BIRTH, PASSPORT, DRIVER_LICENSE, IP_ADDRESS, BIOMETRIC, RACE, RELIGION, POLITICAL_OPINION`;

  const prompt = `Analyze this text for PII:\n\n"${text.slice(0, 2000)}"`;

  try {
    const response = await claudeComplete(prompt, systemPrompt, 512);
    // Try to parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (err) {
    console.warn('[PII] Claude NER scan failed, using regex only:', err.message);
    return null;
  }
}

/**
 * Main PII detection function
 * @param {string} text - Input text to scan
 * @param {boolean} useAI - Whether to use Claude NER in addition to regex
 */
async function detectPII(text, useAI = true) {
  if (!text || typeof text !== 'string') {
    return { passed: true, reason: 'No text to scan', confidence: 1.0, detections: [] };
  }

  const regexDetections = await regexScan(text);

  let aiResult = null;
  if (useAI) {
    aiResult = await claudeNERScan(text);
  }

  const hasRegexPII = regexDetections.length > 0;
  const hasAIPII = aiResult?.has_pii || false;
  const hasPII = hasRegexPII || hasAIPII;

  // Combine detections
  const allDetections = [...regexDetections];
  if (aiResult?.entities) {
    for (const entity of aiResult.entities) {
      if (!allDetections.find((d) => d.type === entity.type)) {
        allDetections.push(entity);
      }
    }
  }

  // Calculate confidence
  let confidence = 0.0;
  if (hasRegexPII && hasAIPII) confidence = 0.99;
  else if (hasRegexPII) confidence = 0.92;
  else if (hasAIPII) confidence = aiResult.confidence || 0.85;
  else confidence = 1.0; // Confident it's clean

  const criticalDetections = allDetections.filter((d) =>
    ['critical', 'high'].includes(d.severity)
  );

  return {
    passed: !hasPII,
    reason: hasPII
      ? `PII detected: ${allDetections.map((d) => d.type).join(', ')}`
      : 'No PII detected',
    confidence,
    detections: allDetections,
    has_critical: criticalDetections.length > 0,
    violation_type: hasPII ? 'pii' : null,
    severity: criticalDetections.length > 0
      ? 'critical'
      : allDetections.length > 0
      ? 'high'
      : null,
  };
}

module.exports = { detectPII };

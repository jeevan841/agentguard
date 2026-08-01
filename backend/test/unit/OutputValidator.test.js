/**
 * test/unit/OutputValidator.test.js
 *
 * Tests for OutputValidator: blocklist, topic restriction,
 * JSON schema validation, and length checks.
 * Pure logic — no DB, no network needed.
 */
'use strict';

jest.setTimeout(10000);

const { validateOutput } = require('../../src/services/guardrail/OutputValidator');

describe('validateOutput — clean output', () => {
  test('passes clean output with no rules', async () => {
    const result = await validateOutput('This is a perfectly fine response.', {});
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test('returns passed:true for empty input', async () => {
    const result = await validateOutput('', {});
    expect(result.passed).toBe(true);
  });

  test('returns passed:true for null input', async () => {
    const result = await validateOutput(null, {});
    expect(result.passed).toBe(true);
  });
});

describe('validateOutput — blocklist', () => {
  test('flags default blocklist violation: "bomb making"', async () => {
    const result = await validateOutput('Here is a guide to bomb making at home.', {});
    expect(result.passed).toBe(false);
    const types = result.violations.map((v) => v.type);
    expect(types).toContain('blocklist');
  });

  test('flags custom blocklist word', async () => {
    const result = await validateOutput(
      'You should definitely buy competitor XYZ today.',
      { blocklist: ['buy competitor'] }
    );
    expect(result.passed).toBe(false);
    const blocklist = result.violations.find((v) => v.type === 'blocklist');
    expect(blocklist).toBeDefined();
    expect(blocklist.details).toContain('buy competitor');
  });

  test('passes output not in blocklist', async () => {
    const result = await validateOutput('The weather is lovely today.', {
      blocklist: ['buy competitor'],
    });
    expect(result.passed).toBe(true);
  });
});

describe('validateOutput — topic restrictions', () => {
  test('flags restricted topic: politics', async () => {
    const result = await validateOutput(
      'You should vote for the Republican candidate in the election.',
      { restricted_topics: ['politics'] }
    );
    expect(result.passed).toBe(false);
    const topicVio = result.violations.find((v) => v.type === 'topic_restriction');
    expect(topicVio).toBeDefined();
    expect(topicVio.details).toContain('politics');
  });

  test('does not flag topic not in restricted list', async () => {
    const result = await validateOutput(
      'You should vote for the Republican candidate.',
      { restricted_topics: ['medical_advice'] }
    );
    // politics not restricted → passes
    expect(result.passed).toBe(true);
  });
});

describe('validateOutput — JSON schema', () => {
  test('passes when output JSON satisfies schema', async () => {
    const output = 'Here is the result: {"name": "Alice", "score": 42}';
    const result = await validateOutput(output, {
      output_schema: {
        required: ['name', 'score'],
        properties: { name: { type: 'string' }, score: { type: 'number' } },
      },
    });
    expect(result.passed).toBe(true);
  });

  test('fails when required JSON field is missing', async () => {
    const output = 'Result: {"name": "Alice"}';
    const result = await validateOutput(output, {
      output_schema: {
        required: ['name', 'score'],
      },
    });
    expect(result.passed).toBe(false);
    const schemaVio = result.violations.find((v) => v.type === 'schema_violation');
    expect(schemaVio).toBeDefined();
  });

  test('fails when no JSON found but schema.required is set', async () => {
    const output = 'Just some plain text, no JSON here.';
    const result = await validateOutput(output, {
      output_schema: { required: ['id'] },
    });
    expect(result.passed).toBe(false);
  });
});

describe('validateOutput — length constraints', () => {
  test('fails when output exceeds max_length', async () => {
    const result = await validateOutput('a'.repeat(200), { max_length: 100 });
    expect(result.passed).toBe(false);
    const lengthVio = result.violations.find((v) => v.type === 'length_violation');
    expect(lengthVio).toBeDefined();
  });

  test('fails when output is below min_length', async () => {
    const result = await validateOutput('hi', { min_length: 50 });
    expect(result.passed).toBe(false);
    const lengthVio = result.violations.find((v) => v.type === 'length_violation');
    expect(lengthVio).toBeDefined();
  });

  test('passes when within length bounds', async () => {
    const result = await validateOutput('Hello, this is a response.', {
      min_length: 5,
      max_length: 100,
    });
    expect(result.passed).toBe(true);
  });
});

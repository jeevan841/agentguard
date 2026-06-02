const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');

let client = null;

function getClaudeClient() {
  if (!client && config.hasClaudeKey) {
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}

/**
 * Make a Claude API call with graceful fallback when no API key is present.
 * @param {string} prompt - The user message
 * @param {string} systemPrompt - System instructions
 * @param {number} maxTokens - Max output tokens
 * @returns {Promise<string>} - The response text
 */
async function claudeComplete(prompt, systemPrompt = '', maxTokens = 1024) {
  const claude = getClaudeClient();

  if (!claude) {
    // Return a structured fallback when API key is not configured
    return JSON.stringify({
      fallback: true,
      message: 'Claude API not configured — rule-based analysis used instead',
    });
  }

  try {
    const response = await claude.messages.create({
      model: config.anthropic.model,
      max_tokens: maxTokens,
      system: systemPrompt || 'You are an AI security analysis assistant for AgentGuard.',
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0]?.text || '';
  } catch (error) {
    console.error('[Claude] API error:', error.message);
    throw error;
  }
}

module.exports = { getClaudeClient, claudeComplete };

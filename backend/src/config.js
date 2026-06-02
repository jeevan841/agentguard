require('dotenv').config();

/**
 * Validate JWT secret for security
 */
function validateJWTSecret(secret) {
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long. Generate one with: openssl rand -base64 32');
  }
  
  const insecureDefaults = [
    'super_secret_jwt_key_change_in_production',
    'your-super-secret-32-char-key',
    'change_me',
    'super_secret_jwt_key_change_in_production_32chars',
  ];
  
  if (insecureDefaults.includes(secret)) {
    throw new Error('JWT_SECRET cannot be a default/example value. Generate a secure one with: openssl rand -base64 32');
  }
  
  // Check for sufficient entropy (at least 16 unique characters)
  const uniqueChars = new Set(secret).size;
  if (uniqueChars < 16) {
    throw new Error('JWT_SECRET has insufficient entropy (too repetitive). Use a randomly generated secret.');
  }
  
  return secret;
}

/**
 * Validate required environment variables
 */
function validateRequiredEnvVars() {
  const required = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET'];
  const missing = required.filter(v => !process.env[v]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// Validate environment on startup
validateRequiredEnvVars();

const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    url: process.env.REDIS_URL,
    password: process.env.REDIS_PASSWORD || null,
    tls: process.env.REDIS_TLS === 'true',
  },

  jwt: {
    secret: validateJWTSecret(process.env.JWT_SECRET),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    capabilityExpiresIn: process.env.CAPABILITY_TOKEN_EXPIRES_IN || '1h',
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  },

  alerts: {
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || '',
    email: process.env.ALERT_EMAIL || '',
  },

  isDev: process.env.NODE_ENV !== 'production',
  hasClaudeKey: !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'sk-ant-your-key-here',
};

module.exports = config;

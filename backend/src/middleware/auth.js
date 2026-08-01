/**
 * Auth Middleware
 * Validates JWT management tokens and capability tokens
 */
const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Middleware: require a valid management JWT
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header. Expected: Bearer <token>',
    });
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });

    // Reject non-management tokens (e.g. capability or mfa_temp tokens signed
    // with the same secret must NOT be usable on management-only routes).
    if (payload.type !== 'management') {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token type' });
    }

    req.user = payload;
    next();
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError'
        ? 'Token has expired'
        : err.name === 'JsonWebTokenError'
        ? 'Invalid token'
        : 'Token verification failed';

    return res.status(401).json({ error: 'Unauthorized', message });
  }
}

/**
 * Middleware: require a valid capability token (for agent-to-agent calls)
 */
function requireCapabilityToken(req, res, next) {
  const token =
    req.headers['x-capability-token'] ||
    req.headers['x-agent-token'];

  if (!token) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Missing capability token. Pass it as X-Capability-Token header.',
    });
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });

    if (payload.type !== 'capability') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Token is not a capability token',
      });
    }

    req.capability = payload;
    next();
  } catch (err) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid or expired capability token',
    });
  }
}

/**
 * Middleware: require one of the given roles on the management JWT.
 * Must be used AFTER requireAuth (which populates req.user).
 *
 * Permission matrix (minimum safe defaults — review with product owner for
 * finer-grained decisions):
 *   admin    — full access to everything
 *   operator — can run guardrail/redteam, manage agents/policies/webhooks
 *   viewer   — read-only (GET routes only); rejected from all mutations
 *
 * @param {...string} roles  One or more allowed roles (e.g. 'admin', 'operator')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    const userRole = req.user?.role;
    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `This action requires one of the following roles: ${roles.join(', ')}. Your role: ${userRole || 'unknown'}.`,
      });
    }
    next();
  };
}

/**
 * Middleware: validate that the capability token allows a specific tool
 */
function requireTool(toolName) {
  return (req, res, next) => {
    const capability = req.capability;
    if (!capability) {
      return res.status(403).json({ error: 'Forbidden', message: 'No capability token' });
    }

    const allowed = capability.allowed_tools || [];
    if (!allowed.includes(toolName) && !allowed.includes('*')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Tool "${toolName}" is not in this agent's allowed_tools: [${allowed.join(', ')}]`,
      });
    }

    next();
  };
}


/**
 * Generate a management JWT
 */
function generateManagementToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, type: 'management' },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

/**
 * Generate a capability token for an agent session
 */
function generateCapabilityToken(agent, parentCapability = null) {
  // If delegating from a parent, restrict to subset of parent's permissions
  let allowedTools = agent.allowed_tools;
  let allowedScopes = agent.allowed_data_scopes;

  if (parentCapability) {
    allowedTools = allowedTools.filter((t) => parentCapability.allowed_tools.includes(t));
    allowedScopes = allowedScopes.filter((s) => parentCapability.allowed_data_scopes.includes(s));
  }

  return jwt.sign(
    {
      agent_id: agent.id,
      agent_name: agent.name,
      allowed_tools: allowedTools,
      allowed_data_scopes: allowedScopes,
      max_token_budget: agent.max_token_budget,
      parent_agent_id: parentCapability?.agent_id || null,
      type: 'capability',
    },
    config.jwt.secret,
    { expiresIn: config.jwt.capabilityExpiresIn }
  );
}

module.exports = {
  requireAuth,
  requireRole,
  requireCapabilityToken,
  requireTool,
  generateManagementToken,
  generateCapabilityToken,
};

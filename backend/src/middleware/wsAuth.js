/**
 * WebSocket Authentication Middleware
 * Validates JWT tokens and enforces connection limits
 */
const jwt = require('jsonwebtoken');
const config = require('../config');
const { URL } = require('url');

// Track connections per IP
const wsConnectionLimits = new Map();
const MAX_CONNECTIONS_PER_IP = 5;
const CLEANUP_INTERVAL = 60000; // 1 minute

// Cleanup stale entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of wsConnectionLimits.entries()) {
    if (now - data.lastActivity > 300000) { // 5 minutes inactive
      wsConnectionLimits.delete(ip);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Authenticate WebSocket connection
 * @param {WebSocket} ws - WebSocket instance
 * @param {IncomingMessage} req - HTTP request
 * @returns {Object|null} - Authentication data or null if failed
 */
function authenticateWebSocket(ws, req) {
  const ip = req.socket.remoteAddress || 'unknown';
  
  // Check connection limit per IP
  const currentData = wsConnectionLimits.get(ip) || { count: 0, lastActivity: Date.now() };
  
  if (currentData.count >= MAX_CONNECTIONS_PER_IP) {
    ws.close(1008, 'Too many connections from this IP');
    console.warn(`[WS] Connection limit exceeded for IP: ${ip}`);
    return null;
  }
  
  // Extract token from query params or headers
  let token = null;
  
  try {
    const url = new URL(req.url, `ws://${req.headers.host}`);
    token = url.searchParams.get('token');
  } catch (err) {
    console.error('[WS] Failed to parse URL:', err.message);
  }
  
  // Fallback to Sec-WebSocket-Protocol header
  if (!token && req.headers['sec-websocket-protocol']) {
    token = req.headers['sec-websocket-protocol'];
  }
  
  if (!token) {
    ws.close(1008, 'Authentication required');
    console.warn(`[WS] No token provided from IP: ${ip}`);
    return null;
  }
  
  // Verify JWT
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    
    if (payload.type !== 'management') {
      ws.close(1008, 'Invalid token type');
      console.warn(`[WS] Invalid token type from IP: ${ip}`);
      return null;
    }
    
    // Update connection count
    wsConnectionLimits.set(ip, {
      count: currentData.count + 1,
      lastActivity: Date.now(),
    });
    
    return { user: payload, ip };
  } catch (err) {
    ws.close(1008, 'Invalid or expired token');
    console.warn(`[WS] Token verification failed from IP: ${ip} - ${err.message}`);
    return null;
  }
}

/**
 * Decrement connection count for an IP
 * @param {string} ip - IP address
 */
function decrementConnectionCount(ip) {
  const data = wsConnectionLimits.get(ip);
  if (data) {
    data.count = Math.max(0, data.count - 1);
    data.lastActivity = Date.now();
    wsConnectionLimits.set(ip, data);
  }
}

/**
 * Get current connection statistics
 * @returns {Object} - Connection stats
 */
function getConnectionStats() {
  const stats = {
    totalIPs: wsConnectionLimits.size,
    totalConnections: 0,
    ips: [],
  };
  
  for (const [ip, data] of wsConnectionLimits.entries()) {
    stats.totalConnections += data.count;
    stats.ips.push({ ip, count: data.count, lastActivity: new Date(data.lastActivity) });
  }
  
  return stats;
}

module.exports = {
  authenticateWebSocket,
  decrementConnectionCount,
  getConnectionStats,
  MAX_CONNECTIONS_PER_IP,
};

// Made with Bob

const Redis = require('ioredis');
const config = require('../config');

let redis = null;
let subscriber = null;

function createRedisClient(options = {}) {
  const redisConfig = {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableReadyCheck: true,
    connectTimeout: 10000,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    ...options,
  };
  
  // Add TLS in production
  if (config.redis.tls || process.env.NODE_ENV === 'production') {
    redisConfig.tls = {
      rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false',
    };
  }
  
  // Add password if provided
  if (config.redis.password) {
    redisConfig.password = config.redis.password;
  }
  
  const client = new Redis(config.redis.url, redisConfig);

  client.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
  });

  client.on('connect', () => {
    console.log('[Redis] Connected successfully');
  });
  
  client.on('ready', () => {
    console.log('[Redis] Ready to accept commands');
  });
  
  client.on('reconnecting', (delay) => {
    console.log(`[Redis] Reconnecting in ${delay}ms...`);
  });

  return client;
}

function getRedis() {
  if (!redis) {
    redis = createRedisClient();
  }
  return redis;
}

function getSubscriber() {
  if (!subscriber) {
    subscriber = createRedisClient();
  }
  return subscriber;
}

// Graceful shutdown
process.on('beforeExit', async () => {
  if (redis) await redis.quit();
  if (subscriber) await subscriber.quit();
});

module.exports = { getRedis, getSubscriber };

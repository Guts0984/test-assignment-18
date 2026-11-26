import { Redis } from 'ioredis';
import { type Logger } from './logger';

/** A connection that fails fast while Redis is down instead of queueing commands. */
export const createRedis = (url: string, logger: Logger, keyPrefix = ''): Redis => {
  const redis = new Redis(url, {
    keyPrefix,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 1_000,
    retryStrategy: (attempt) => Math.min(attempt * 100, 2_000),
  });
  redis.on('error', (error) => {
    logger.warn({ error: error.message }, 'redis connection error');
  });
  return redis;
};

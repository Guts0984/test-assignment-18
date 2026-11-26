import { Redis } from 'ioredis';

/** A producer connection: commands fail fast instead of piling up while Redis is down. */
export const connectionFor = (url: string): Redis =>
  new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 2_000,
    retryStrategy: (attempt) => Math.min(attempt * 100, 2_000),
  });

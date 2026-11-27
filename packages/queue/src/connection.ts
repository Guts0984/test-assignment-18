import { Redis } from 'ioredis';

/** A producer connection: commands fail fast instead of piling up while Redis is down. */
export const connectionFor = (url: string): Redis =>
  new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 2_000,
    retryStrategy: (attempt) => Math.min(attempt * 100, 2_000),
  });

/**
 * Waits until a connection that is still being opened is usable, or clearly is not. Closing one
 * in mid-handshake rejects the commands queued on it.
 */
export const settled = (connection: Redis, timeoutMs = 2_000): Promise<void> =>
  new Promise((resolve) => {
    if (['ready', 'end', 'close', 'reconnecting'].includes(connection.status)) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      for (const event of ['ready', 'close', 'end']) connection.off(event, done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    for (const event of ['ready', 'close', 'end']) connection.on(event, done);
  });

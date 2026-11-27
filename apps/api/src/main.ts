import { createDb } from '@school/db/client';
import { createPublisher } from '@school/queue/publisher';
import { createRealtime } from '@school/queue/realtime';
import { createSharedTestTime, systemTime } from '@school/db/time';
import { createApp } from './app.factory';
import { createDrain } from './common/http/drain';
import { loadEnv } from './config/env';
import { queueSettings } from './infra/queue-settings';
import { createLogger } from './infra/logger';
import { createRedis } from './infra/redis';

/** How long a leaving copy waits. Docker kills a container ten seconds after asking. */
const LEAVING = { quietMs: 1_000, limitMs: 7_000 } as const;

const main = async (): Promise<void> => {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const db = createDb(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL, logger);
  const jobs = createPublisher(queueSettings(env), (error) => {
    logger.warn({ error }, 'job publishing failed');
  });
  const realtime = createRealtime(
    { redisUrl: env.REDIS_URL, prefix: env.QUEUE_PREFIX },
    (error) => {
      logger.warn({ error }, 'realtime publishing failed');
    },
  );
  const time = env.TEST_CLOCK_ENABLED ? createSharedTestTime(db) : systemTime;
  const drain = createDrain();
  const app = await createApp({ env, db, redis, time, logger, jobs, realtime }, drain);
  await app.listen(env.API_PORT, '0.0.0.0');
  logger.info({ port: env.API_PORT, instance: env.INSTANCE_ID }, 'api listening');

  const stop = async (): Promise<void> => {
    // Running requests are answered before anything they need is closed.
    await drain.leave(app.getHttpServer(), LEAVING);
    await app.close();
    await jobs.close();
    await realtime.close();
    redis.disconnect();
    await db.$disconnect();
    process.exit(0);
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
};

main().catch((error: unknown) => {
  process.stderr.write(
    `api failed to start: ${error instanceof Error ? (error.stack ?? '') : ''}\n`,
  );
  process.exit(1);
});

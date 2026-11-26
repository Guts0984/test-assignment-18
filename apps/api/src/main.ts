import { createDb } from '@school/db/client';
import { createPublisher } from '@school/queue/publisher';
import { createSharedTestTime, systemTime } from '@school/db/time';
import { createApp } from './app.factory';
import { loadEnv } from './config/env';
import { queueSettings } from './infra/queue-settings';
import { createLogger } from './infra/logger';
import { createRedis } from './infra/redis';

const main = async (): Promise<void> => {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const db = createDb(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL, logger);
  const jobs = createPublisher(queueSettings(env), (error) => {
    logger.warn({ error }, 'job publishing failed');
  });
  const time = env.TEST_CLOCK_ENABLED ? createSharedTestTime(db) : systemTime;
  const app = await createApp({ env, db, redis, time, logger, jobs });
  await app.listen(env.API_PORT, '0.0.0.0');
  logger.info({ port: env.API_PORT, instance: env.INSTANCE_ID }, 'api listening');

  const stop = async (): Promise<void> => {
    await app.close();
    await jobs.close();
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

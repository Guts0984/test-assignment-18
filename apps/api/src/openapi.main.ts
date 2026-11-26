import { writeFile } from 'node:fs/promises';
import { createDb } from '@school/db/client';
import { createPublisher } from '@school/queue/publisher';
import { systemTime } from '@school/db/time';
import { createApp } from './app.factory';
import { loadEnv } from './config/env';
import { queueSettings } from './infra/queue-settings';
import { createLogger } from './infra/logger';
import { createRedis } from './infra/redis';
import { buildOpenApi } from './openapi';

/** Writes the OpenAPI document the web client is generated from. Needs no running services. */
const main = async (): Promise<void> => {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: openapi.main <output file>');
  const env = { ...loadEnv(), TEST_CLOCK_ENABLED: false };
  const logger = createLogger('silent');
  const db = createDb(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL, logger);
  const jobs = createPublisher(queueSettings(env), (error) => {
    logger.warn({ error }, 'job publishing failed');
  });
  const app = await createApp({ env, db, redis, time: systemTime, logger, jobs });
  await writeFile(output, `${JSON.stringify(buildOpenApi(app), null, 2)}\n`);
  await app.close();
  await jobs.close();
  redis.disconnect();
};

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? '') : ''}\n`);
    process.exit(1);
  });

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createDb } from '@school/db/client';
import { createSharedTestTime, systemTime } from '@school/db/time';
import { createPublisher } from '@school/queue/publisher';
import { createRealtime } from '@school/queue/realtime';
import pino from 'pino';
import { loadEnv } from './config/env';
import { type WorkerDeps } from './deps';
import { createMailer } from './mail/mailer';
import { WorkerModule } from './worker.module';

const main = async (): Promise<void> => {
  const env = loadEnv();
  const logger = pino({ level: env.LOG_LEVEL });
  const db = createDb(env.DATABASE_URL);
  const onError = (error: string) => {
    logger.warn({ error }, 'redis publishing failed');
  };
  const deps: WorkerDeps = {
    env,
    logger,
    db,
    time: env.TEST_CLOCK_ENABLED ? createSharedTestTime(db) : systemTime,
    jobs: createPublisher(
      {
        redisUrl: env.REDIS_URL,
        prefix: env.QUEUE_PREFIX,
        attempts: env.JOB_ATTEMPTS,
        backoffMs: env.JOB_BACKOFF_MS,
      },
      onError,
    ),
    realtime: createRealtime({ redisUrl: env.REDIS_URL, prefix: env.QUEUE_PREFIX }, onError),
    mailer: createMailer({ host: env.SMTP_HOST, port: env.SMTP_PORT, from: env.MAIL_FROM }),
  };
  const app = await NestFactory.createApplicationContext(WorkerModule.register(deps), {
    logger: false,
    abortOnError: false,
  });

  const stop = async (): Promise<void> => {
    await app.close();
    await deps.jobs.close();
    await deps.realtime.close();
    deps.mailer.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
};

main().catch((error: unknown) => {
  process.stderr.write(
    `worker failed to start: ${error instanceof Error ? (error.stack ?? '') : ''}\n`,
  );
  process.exit(1);
});

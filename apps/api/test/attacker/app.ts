import { randomBytes } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { createDb } from '@school/db/client';
import { createTestDatabase } from '@school/db/testing/database';
import { createPublisher } from '@school/queue/publisher';
import { createRealtime } from '@school/queue/realtime';
import { fromClock } from '@school/db/time';
import { createFixedClock } from '@school/shared/clock/clock';
import { QUEUE_NAMES } from '@school/shared/jobs/registry';
import { createApp } from '../../src/app.factory';
import { type EnvSource, loadEnv } from '../../src/config/env';
import { type Deps } from '../../src/infra/deps';
import { createLogger } from '../../src/infra/logger';
import { createRedis } from '../../src/infra/redis';
import { queueSettings } from '../../src/infra/queue-settings';

/** The business time every in-process test starts at. */
export const NOW = new Date('2026-03-01T10:00:00.000Z');

const LOOSE_LIMITS: EnvSource = {
  RATE_LIMIT_LOGIN_IP_MAX: '100000',
  RATE_LIMIT_LOGIN_ACCOUNT_MAX: '100000',
  RATE_LIMIT_REGISTER_IP_MAX: '100000',
};

export type ApiCopy = { readonly url: string; readonly deps: Deps };

/** A port that is free right now, so a copy can be told its own address before it starts. */
const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => {
        resolve(port);
      });
    });
  });

/** Deletes the queue keys a test created in the shared Redis. */
const removeQueues = async (deps: Deps): Promise<void> => {
  await Promise.all(QUEUE_NAMES.map((name) => deps.jobs.queue(name).obliterate({ force: true })));
};

const listen = async (deps: Deps, port: number) => {
  const app = await createApp(deps);
  await app.listen(port, '127.0.0.1');
  return { app, url: `http://127.0.0.1:${port}` };
};

/**
 * Boots the real application on a private database and Redis namespace, with a clock the test
 * moves. `copies` starts several instances that share both, as behind a load balancer.
 */
export const startApi = async (
  options: { readonly env?: EnvSource; readonly copies?: number } = {},
) => {
  const database = await createTestDatabase(process.env['DATABASE_URL'] ?? '');
  const clock = createFixedClock(NOW);
  const logger = createLogger('silent');
  const prefix = `test:${randomBytes(6).toString('hex')}:`;
  const ports = await Promise.all(Array.from({ length: options.copies ?? 1 }, freePort));
  const instances = await Promise.all(
    ports.map(async (port, index) => {
      const env = loadEnv({
        ...process.env,
        ...LOOSE_LIMITS,
        NODE_ENV: 'test',
        TEST_CLOCK_ENABLED: 'false',
        DATABASE_URL: database.url,
        INSTANCE_ID: `api-${index + 1}`,
        WEBHOOK_CALLBACK_URL: `http://127.0.0.1:${ports[0]}/api/payments/webhook`,
        ...options.env,
      });
      const redis = createRedis(env.REDIS_URL, logger, prefix);
      await new Promise<void>((resolve) => {
        redis.once('ready', resolve);
        redis.once('error', () => {
          resolve();
        });
      });
      const jobs = createPublisher(queueSettings({ ...env, QUEUE_PREFIX: prefix }), () => {});
      const time = fromClock(clock);
      // Each copy has its own pool, as separate processes would.
      const db = createDb(database.url);
      const realtime = createRealtime({ redisUrl: env.REDIS_URL, prefix }, () => {});
      // Socket adapters of one test share a namespace that no other test uses.
      const shared = Object.freeze({ ...env, QUEUE_PREFIX: prefix });
      const deps: Deps = { env: shared, db, redis, time, logger, jobs, realtime };
      return { ...(await listen(deps, port)), deps };
    }),
  );
  const [first] = instances;
  if (!first) throw new Error('At least one copy is required');
  return {
    url: first.url,
    copies: instances.map(({ url, deps }): ApiCopy => ({ url, deps })),
    app: first.app,
    deps: first.deps,
    db: database.db,
    databaseUrl: database.url,
    clock,
    stop: async () => {
      for (const instance of instances) {
        await instance.app.close();
        if (instance.deps.redis.status === 'ready') await removeQueues(instance.deps);
        await instance.deps.jobs.close();
        instance.deps.realtime.close();
        instance.deps.redis.disconnect();
        await instance.deps.db.$disconnect();
      }
      await database.drop();
    },
  };
};

export type TestApi = Awaited<ReturnType<typeof startApi>>;

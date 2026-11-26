import { randomBytes } from 'node:crypto';
import { type AddressInfo } from 'node:net';
import { createTestDatabase } from '@school/db/testing/database';
import { fromClock } from '@school/db/time';
import { createFixedClock } from '@school/shared/clock/clock';
import { createApp } from '../../src/app.factory';
import { type EnvSource, loadEnv } from '../../src/config/env';
import { type Deps } from '../../src/infra/deps';
import { createLogger } from '../../src/infra/logger';
import { createRedis } from '../../src/infra/redis';

/** The business time every in-process test starts at. */
export const NOW = new Date('2026-03-01T10:00:00.000Z');

const LOOSE_LIMITS: EnvSource = {
  RATE_LIMIT_LOGIN_IP_MAX: '100000',
  RATE_LIMIT_LOGIN_ACCOUNT_MAX: '100000',
  RATE_LIMIT_REGISTER_IP_MAX: '100000',
};

export type ApiCopy = { readonly url: string; readonly deps: Deps };

const listen = async (deps: Deps) => {
  const app = await createApp(deps);
  await app.listen(0, '127.0.0.1');
  const { port } = (app.getHttpServer() as { address: () => AddressInfo }).address();
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
  const instances = await Promise.all(
    Array.from({ length: options.copies ?? 1 }, async (_, index) => {
      const env = loadEnv({
        ...process.env,
        ...LOOSE_LIMITS,
        NODE_ENV: 'test',
        TEST_CLOCK_ENABLED: 'false',
        DATABASE_URL: database.url,
        INSTANCE_ID: `api-${index + 1}`,
        ...options.env,
      });
      const redis = createRedis(env.REDIS_URL, logger, prefix);
      await new Promise<void>((resolve) => {
        redis.once('ready', resolve);
        redis.once('error', () => {
          resolve();
        });
      });
      const deps: Deps = { env, db: database.db, redis, time: fromClock(clock), logger };
      return { ...(await listen(deps)), deps };
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
    clock,
    stop: async () => {
      for (const instance of instances) {
        await instance.app.close();
        instance.deps.redis.disconnect();
      }
      await database.drop();
    },
  };
};

export type TestApi = Awaited<ReturnType<typeof startApi>>;

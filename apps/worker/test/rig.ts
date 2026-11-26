import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { holdSeat } from '@school/db/repo/hold';
import { type Unit } from '@school/db/repo/context';
import { runUnit } from '@school/db/repo/unit-of-work';
import { createTestDatabase } from '@school/db/testing/database';
import { createCohort, createUser } from '@school/db/testing/factories';
import { createSharedTestTime, setSharedTestTime } from '@school/db/time';
import { seal } from '@school/gateway/secret-box';
import { loadEnv as loadStubEnv } from '@school/paystub/config/env';
import { startStub, type Stub } from '@school/paystub/server';
import { createPublisher } from '@school/queue/publisher';
import { Redis } from 'ioredis';

export const MERCHANT_KEY = 'merchant-key-used-by-tests-0001';
const ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');

/** A private Redis database, so a flush in one chaos test touches nothing else. */
const privateRedis = (url: string): string => {
  const parsed = new URL(url);
  parsed.pathname = '/9';
  return parsed.toString();
};

export const until = async <T>(
  probe: () => Promise<T>,
  what: string,
  timeoutMs = 45_000,
): Promise<NonNullable<T>> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

export const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Real infrastructure for worker chaos: a private database, a Redis namespace, the payment
 * stub, and worker processes built from source that can be killed outright.
 */
export const startRig = async (options: { readonly now?: Date } = {}) => {
  const database = await createTestDatabase(process.env['DATABASE_URL'] ?? '', 10);
  const redisUrl = privateRedis(process.env['REDIS_URL'] ?? '');
  const prefix = `chaos:${randomBytes(6).toString('hex')}`;
  const start = options.now ?? new Date('2026-03-01T10:00:00.000Z');
  await setSharedTestTime(database.db, start);
  const time = createSharedTestTime(database.db);
  const redis = new Redis(redisUrl);
  await redis.flushdb();
  const stub: Stub = await startStub(
    loadStubEnv({
      PAYSTUB_PORT: '0',
      PAYSTUB_DATABASE_URL: database.url.split('?')[0],
      PAYSTUB_MERCHANT_KEY: MERCHANT_KEY,
      PAYSTUB_RETRY_BASE_MS: '100',
      TEST_CONTROL_TOKEN: 'stub-control-token-0001',
    }),
  );
  const env = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: database.url,
    REDIS_URL: redisUrl,
    QUEUE_PREFIX: prefix,
    WORKER_CONCURRENCY: '4',
    SWEEP_INTERVAL_MS: '200',
    JOB_ATTEMPTS: '3',
    JOB_BACKOFF_MS: '50',
    JOB_LOCK_MS: '2000',
    EMAIL_LEASE_MS: '2000',
    GATEWAY_ENCRYPTION_KEY: ENCRYPTION_KEY,
    // Refund notifications are not needed here: the response books the refund.
    WEBHOOK_CALLBACK_URL: 'http://127.0.0.1:1/api/payments/webhook',
    PAYSTUB_HTTP_TIMEOUT_MS: '1500',
    SMTP_HOST: process.env['SMTP_HOST'] ?? '127.0.0.1',
    SMTP_PORT: process.env['SMTP_PORT'] ?? '1025',
    TEST_CLOCK_ENABLED: 'true',
  };
  const jobs = createPublisher({ redisUrl, prefix, attempts: 3, backoffMs: 50 }, () => undefined);
  const processes: ChildProcess[] = [];
  const errors: string[] = [];

  const startWorker = (): ChildProcess => {
    const child = spawn(process.execPath, [join(__dirname, '..', 'dist', 'main.js')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk.toString()));
    child.stdout.on('data', () => undefined);
    processes.push(child);
    return child;
  };

  const kill = async (child: ChildProcess): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const gone = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGKILL');
    await gone;
  };

  const unit = async <T>(work: (unit: Unit) => Promise<T>) =>
    (
      await runUnit(
        database.db,
        { now: await time.now(), timings: { holdTtlSec: 900, offerTtlSec: 86_400 } },
        work,
      )
    ).value;

  const cohort = async (capacity: number) => {
    const created = await createCohort(database.db, { capacity });
    await database.db.gatewayConfig.create({
      data: {
        schoolId: created.school.id,
        baseUrl: stub.url,
        keyCiphertext: seal(MERCHANT_KEY, ENCRYPTION_KEY),
        keyLast4: MERCHANT_KEY.slice(-4),
        updatedAt: start,
      },
    });
    return created;
  };

  /** Books `count` seats for new students through the real rules. */
  const holds = async (cohortId: string, count: number): Promise<string[]> => {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const student = await createUser(database.db);
      const outcome = await unit((u) =>
        holdSeat(u, { cohortId, studentId: student.id, promoCode: undefined }),
      );
      if (typeof outcome === 'string') throw new Error(outcome);
      ids.push(outcome.enrollmentId);
    }
    return ids;
  };

  return {
    db: database.db,
    redis,
    stub,
    jobs,
    errors,
    start,
    unit,
    cohort,
    holds,
    startWorker,
    kill,
    now: time.now,
    setTime: (instant: Date) => setSharedTestTime(database.db, instant),
    flushRedis: () => redis.flushdb(),
    stop: async () => {
      await Promise.all(processes.map(kill));
      await jobs.close();
      await stub.stop();
      await redis.flushdb();
      redis.disconnect();
      await database.drop();
    },
  };
};

export type Rig = Awaited<ReturnType<typeof startRig>>;

import { describe, expect, it } from 'vitest';
import { startApi } from './attacker/app';
import { client } from './attacker/client';
import { sellingCohort } from './attacker/money';
import { until } from './attacker/poll';
import { student } from './attacker/students';

/** Stopping must never leave a rejected promise behind: it fails a test run, or kills a process. */
const rejectionsDuring = async (work: () => Promise<void>): Promise<string[]> => {
  const seen: string[] = [];
  const record = (reason: unknown) => seen.push(String(reason));
  process.on('unhandledRejection', record);
  try {
    await work();
    // Stopping has waited for the connections to end; their last rejections surface next turn.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', record);
  }
  return seen;
};

describe('shutting down', () => {
  it('is clean when it happens right after starting', async () => {
    const seen = await rejectionsDuring(async () => {
      for (let i = 0; i < 4; i += 1) await (await startApi({ copies: 2 })).stop();
    });
    expect(seen).toEqual([]);
  });

  it('is clean while Redis cannot be reached', async () => {
    const seen = await rejectionsDuring(async () => {
      const api = await startApi({ env: { REDIS_URL: 'redis://127.0.0.1:1' } });
      await api.stop();
    });
    expect(seen).toEqual([]);
  });
});

describe('leaving', () => {
  it('answers a request that is still running, and takes no new ones', async () => {
    const api = await startApi();
    const sale = await sellingCohort(api, { capacity: 2 });
    const buyer = await student(api);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = false;
    // Holding the cohort row keeps the booking running for as long as the test wants.
    const lock = api.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM cohorts WHERE id = ${sale.cohort.id}::uuid FOR UPDATE`;
        locked = true;
        await held;
      },
      { timeout: 20_000 },
    );
    await until(() => Promise.resolve(locked), { what: 'the cohort to be locked' });
    const booking = buyer.http.post('/api/enrollments', { cohortId: sale.cohort.id });
    await until(
      async () => {
        const [waiting] = await api.db.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'`;
        return (waiting?.count ?? 0) > 0;
      },
      { what: 'the booking to wait for the lock' },
    );
    // Counted at the moment leaving ends: by then the running booking must be stored.
    const booked = api.drain
      .leave(api.app.getHttpServer(), { quietMs: 0, limitMs: 10_000 })
      .then(() => api.db.enrollment.count({ where: { cohortId: sale.cohort.id } }));
    await until(
      () =>
        client(api.url)
          .get('/api/health')
          .then(
            () => false,
            (error: unknown) => String(error).includes('ECONNREFUSED'),
          ),
      { what: 'new connections to be refused' },
    );
    release();
    await lock;
    const reply = await booking;
    expect(reply.status).toBe(201);
    expect(reply.headers['connection']).toBe('close');
    expect(await booked).toBe(1);
    await api.stop();
  });
});

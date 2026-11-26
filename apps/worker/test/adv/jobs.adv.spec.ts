import { assertInvariants } from '@school/db/invariants/assert';
import { cancelEnrollment } from '@school/db/repo/cancel';
import { recordPayment } from '@school/db/repo/payment';
import { SYSTEM_ACTOR } from '@school/db/repo/seat-journal';
import { retryJob } from '@school/shared/jobs/retry';
import { type QueueName } from '@school/shared/jobs/registry';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pause, startRig, until, type Rig } from '../rig';

let rig: Rig;
beforeAll(async () => {
  rig = await startRig();
});
afterAll(async () => {
  await rig.stop();
});

const control = (body: object) =>
  fetch(`${rig.stub.url}/control`, {
    method: 'POST',
    headers: { 'x-test-token': 'stub-control-token-0001' },
    body: JSON.stringify(body),
  });

const owedRefunds = async (count: number) => {
  const { cohort, school } = await rig.cohort(count);
  const ids = await rig.holds(cohort.id, count);
  for (const enrollmentId of ids) {
    await rig.unit((u) =>
      recordPayment(u, {
        enrollmentId,
        schoolId: school.id,
        providerPaymentId: `p-${enrollmentId}`,
        amountMinor: 10_000,
        currency: 'UAH',
      }),
    );
    await rig.unit((u) =>
      cancelEnrollment(u, { enrollmentId, actor: SYSTEM_ACTOR, policy: 'rule' }),
    );
  }
  return { school, ids };
};

describe('failed jobs', () => {
  it('are recorded after their last attempt, survive a flush, and succeed on retry', async () => {
    await control({ failRefunds: true });
    const { school, ids } = await owedRefunds(1);
    rig.startWorker();
    const failure = await until(
      () => rig.db.jobFailure.findFirst({ where: { queue: 'refunds', resolvedAt: null } }),
      'the refund to give up',
    );
    expect(failure).toMatchObject({ schoolId: school.id, attempts: 3 });
    expect(failure.error).toContain('unavailable');

    // Given up means given up: neither a flush nor the sweeper tries again by itself.
    const calls = async () =>
      Number(
        (await rig.stub.pool.query<{ n: string }>('SELECT count(*) AS n FROM refund_calls')).rows[0]
          ?.n,
      );
    await rig.flushRedis();
    const before = await calls();
    await pause(1_500);
    expect(await calls()).toBe(before);
    expect(await rig.db.jobFailure.count({ where: { resolvedAt: null } })).toBe(1);

    await control({ failRefunds: false });
    // What the manager's retry does: mark resolved, publish again.
    await rig.db.jobFailure.update({
      where: { id: failure.id },
      data: { resolvedAt: await rig.now() },
    });
    await rig.jobs.publish([retryJob(failure.queue as QueueName, failure.payload)]);
    await until(
      async () =>
        (await rig.db.moneyOperation.count({
          where: { enrollmentId: ids[0] ?? '', kind: 'refund' },
        })) === 1,
      'the refund',
    );
    await pause(500);
    expect(await rig.db.jobFailure.count({ where: { resolvedAt: null } })).toBe(0);
    await assertInvariants(rig.db);
  });
});

describe('several workers', () => {
  it('perform each refund once between them', async () => {
    await control({ failRefunds: false });
    const { ids } = await owedRefunds(40);
    const workers = [rig.startWorker(), rig.startWorker(), rig.startWorker()];
    // The same work is also published many times over.
    const requests = await rig.db.refundRequest.findMany({
      where: { enrollmentId: { in: ids } },
    });
    for (let round = 0; round < 3; round += 1) {
      await rig.jobs.publish(
        requests.map((request) => ({
          ...retryJob('refunds', { refundRequestId: request.id }),
          id: `duplicate_${round}_${request.id}`,
        })),
      );
    }
    await until(
      async () => (await rig.db.refundRequest.count({ where: { status: 'pending' } })) === 0,
      'all refunds',
    );
    await pause(1_000);
    expect(
      await rig.db.moneyOperation.count({ where: { enrollmentId: { in: ids }, kind: 'refund' } }),
    ).toBe(40);
    const gateway = await rig.stub.pool.query(
      'SELECT order_id FROM refunds WHERE order_id = ANY($1)',
      [ids],
    );
    expect(gateway.rowCount).toBe(40);
    await Promise.all(workers.map(rig.kill));
    await assertInvariants(rig.db);
  });
});

import { assertInvariants } from '@school/db/invariants/assert';
import { type Stub } from '@school/paystub/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from '../attacker/app';
import { client } from '../attacker/client';
import { expectError } from '../attacker/expect';
import { deliver, paymentStub, processAll, sellingCohort } from '../attacker/money';
import { until } from '../attacker/poll';
import { students } from '../attacker/students';

let api: TestApi;
let stub: Stub;
let toggle = 0;

beforeAll(async () => {
  api = await startApi({ copies: 2 });
  stub = await paymentStub(
    api,
    {
      PAYSTUB_CHAOS_MODE: 'true',
      PAYSTUB_CHAOS_LATE_PROBABILITY: '0',
      PAYSTUB_CHAOS_API_TARGETS: api.copies.map((copy) => copy.url).join(','),
    },
    // Alternates, so half of the refunds are announced before the call is answered.
    () => ((toggle += 1) % 2 === 0 ? 0.9 : 0.1),
  );
});
afterAll(async () => {
  await stub.stop();
  await api.stop();
});

const control = (body: object) =>
  client(stub.url).post('/control', body, {
    headers: { 'x-test-token': 'stub-control-token-0001' },
  });

/** Pays through the stub's own payment page. */
const payThroughStub = async (count: number) => {
  const sale = await sellingCohort(api, { capacity: count, gatewayUrl: stub.url });
  const buyers = await students(api, count);
  const enrollments = await Promise.all(
    buyers.map(async (buyer) => {
      const held = await buyer.http.post('/api/enrollments', { cohortId: sale.cohort.id });
      const { id } = held.body as { id: string };
      const checkout = await buyer.http.post(`/api/enrollments/${id}/checkout`);
      const { payUrl } = checkout.body as { payUrl: string };
      const again = await buyer.http.post(`/api/enrollments/${id}/checkout`);
      expect(again.body).toEqual({ payUrl });
      const path = new URL(payUrl).pathname;
      expect((await client(stub.url).send('POST', `${path}/pay`)).status).toBe(303);
      return { id, buyer, path };
    }),
  );
  await until(
    async () => {
      await processAll(api);
      return (
        (await api.db.enrollment.count({
          where: { cohortId: sale.cohort.id, status: 'paid' },
        })) === count
      );
    },
    { what: 'all payments' },
  );
  return { ...sale, enrollments };
};

describe('chaos mode', () => {
  it('delivers each payment twice to both copies and counts it once', async () => {
    const { enrollments } = await payThroughStub(8);
    for (const { id, path } of enrollments) {
      // A second click on the payment page takes no more money.
      await client(stub.url).send('POST', `${path}/pay`);
      const operations = await api.db.moneyOperation.findMany({ where: { enrollmentId: id } });
      expect(operations.map((op) => op.kind)).toEqual(['payment']);
    }
    const delivered = await stub.pool.query<{ targets: string[] }>(
      'SELECT targets FROM deliveries',
    );
    expect(delivered.rows.every((row) => new Set(row.targets).size === 2)).toBe(true);
    await assertInvariants(api.db);
  });

  it('brings every refund through errors, timeouts and early notifications, once each', async () => {
    const { enrollments } = await payThroughStub(20);
    for (const { id, buyer } of enrollments) {
      expect((await buyer.http.post(`/api/enrollments/${id}/cancel`)).status).toBe(200);
    }
    const ids = enrollments.map((e) => e.id);
    const pending = () =>
      api.db.refundRequest.findMany({ where: { enrollmentId: { in: ids }, status: 'pending' } });
    let failures = 0;
    await until(
      async () => {
        const open = await pending();
        // Two workers may deliver the same refund at the same moment.
        const results = await Promise.all(
          open.flatMap((request) => [deliver(api, request.id), deliver(api, request.id)]),
        );
        failures += results.filter((result) => !result.ok).length;
        await processAll(api);
        return open.length === 0;
      },
      { what: 'all refunds', timeoutMs: 45_000 },
    );
    expect(failures).toBeGreaterThan(0);
    const atGateway = await stub.pool.query<{ order_id: string; total: string; n: string }>(
      `SELECT order_id, sum(amount_minor) AS total, count(*) AS n FROM refunds
        WHERE order_id = ANY($1) GROUP BY order_id`,
      [ids],
    );
    expect(atGateway.rows).toHaveLength(20);
    expect(atGateway.rows.every((row) => row.n === '1' && row.total === '10000')).toBe(true);
    for (const id of ids) {
      const refunds = await api.db.moneyOperation.count({
        where: { enrollmentId: id, kind: 'refund' },
      });
      expect(refunds).toBe(1);
    }
    await assertInvariants(api.db);
  });

  it('keeps a refund pending while the payment system fails, and completes it later', async () => {
    await control({ chaos: false, failRefunds: true });
    const { enrollments } = await payThroughStub(1);
    const [one] = enrollments;
    await one?.buyer.http.post(`/api/enrollments/${one.id}/cancel`);
    const request = await api.db.refundRequest.findFirstOrThrow({
      where: { enrollmentId: one?.id ?? '' },
    });
    for (let i = 0; i < 3; i += 1) expect((await deliver(api, request.id)).ok).toBe(false);
    expect(
      (await api.db.refundRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe('pending');
    await control({ failRefunds: false });
    expect((await deliver(api, request.id)).ok).toBe(true);
    expect((await deliver(api, request.id)).ok).toBe(true);
    await assertInvariants(api.db);
  });

  it('delivers a payment twenty minutes late, and the money comes back if the seat is gone', async () => {
    await control({ chaos: true, lateProbability: 1 });
    const sale = await sellingCohort(api, { capacity: 1, gatewayUrl: stub.url });
    const [slow, quick] = await students(api, 2);
    if (!slow || !quick) throw new Error('fixture');
    const held = await slow.http.post('/api/enrollments', { cohortId: sale.cohort.id });
    const { id } = held.body as { id: string };
    const { payUrl } = (await slow.http.post(`/api/enrollments/${id}/checkout`)).body as {
      payUrl: string;
    };
    await client(stub.url).send('POST', `${new URL(payUrl).pathname}/pay`);
    const scheduled = await stub.pool.query<{ delay: string }>(
      `SELECT extract(epoch FROM next_at - now()) AS delay FROM deliveries
        WHERE delivered_at IS NULL AND body::json->>'orderId' = $1`,
      [id],
    );
    expect(Number(scheduled.rows[0]?.delay)).toBeGreaterThan(1_150);
    api.clock.advance(20 * 60_000);
    expect((await quick.http.post('/api/enrollments', { cohortId: sale.cohort.id })).status).toBe(
      201,
    );
    expectError(await slow.http.post(`/api/enrollments/${id}/checkout`), 'INVALID_TRANSITION');
    await control({ releaseDelayed: true });
    await until(
      async () => {
        await processAll(api);
        return (await api.db.refundRequest.count({ where: { enrollmentId: id } })) === 1;
      },
      { what: 'the late payment' },
    );
    expect((await api.db.enrollment.findUniqueOrThrow({ where: { id } })).status).toBe('refunded');
    await assertInvariants(api.db);
  });
});

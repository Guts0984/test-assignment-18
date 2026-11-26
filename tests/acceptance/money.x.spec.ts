import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { burst } from '../../apps/api/test/attacker/burst';
import * as stack from '../support/stack';

const MINUTE = 60_000;

beforeAll(stack.resetClock);
afterAll(async () => {
  await stack.stubControl({ chaos: false, failRefunds: false });
  await stack.resetClock();
  await stack.disconnect();
});

describe('acceptance: money', () => {
  it('A-4 a payment at the moment of expiry always ends enrolled or refunded, never both', async () => {
    const owner = await stack.school();
    const seen = new Set<string>();
    for (let round = 0; round < 12; round += 1) {
      await stack.resetClock();
      const cohort = await stack.cohort(owner, { capacity: 1 });
      const [payer, rival] = await stack.people(2);
      if (!payer || !rival) throw new Error('fixture');
      const id = await stack.book(payer, cohort.id);
      const { holdExpiresAt } = await stack.db().enrollment.findUniqueOrThrow({ where: { id } });
      const expiry = holdExpiresAt?.getTime() ?? 0;
      // Alternately a moment before and exactly at the expiry.
      await stack.setClock(new Date(round % 2 === 0 ? expiry - 3_000 : expiry));
      const body = await stack.notice(id);
      await Promise.all([
        stack.notify(body),
        rival.http.post('/api/enrollments', { cohortId: cohort.id }),
      ]);
      const status = await stack.until(async () => {
        const current = await stack.statusOf(id);
        return current === 'paid' || current === 'refunded' ? current : undefined;
      }, 'the payment to be settled');
      seen.add(status);
      const refunds = await stack.db().refundRequest.findMany({ where: { enrollmentId: id } });
      const stored = await stack.db().cohort.findUniqueOrThrow({ where: { id: cohort.id } });
      expect(refunds).toHaveLength(status === 'paid' ? 0 : 1);
      expect(stored.seatsTaken).toBeLessThanOrEqual(1);
      if (status === 'paid') expect(stored.seatsTaken).toBe(1);
    }
    expect([...seen].sort()).toEqual(['paid', 'refunded']);
    await stack.resetClock();
  });

  it('A-6 50 simultaneous payments with a 10-use promo code: exactly 10 are discounted', async () => {
    const owner = await stack.school();
    const cohort = await stack.cohort(owner, { capacity: 60 });
    const promo = await stack.db().promoCode.create({
      data: {
        schoolId: owner.id,
        code: 'TENUSES',
        discountKind: 'percent',
        percent: 50,
        validFrom: new Date('2020-01-01'),
        validUntil: new Date('2090-01-01'),
        maxUses: 10,
      },
    });
    const crowd = await stack.people(50);
    const held = await burst(50, async (i) => {
      const reply = await crowd[i]?.http.post('/api/enrollments', {
        cohortId: cohort.id,
        promoCode: 'TENUSES',
      });
      return reply?.body as { id: string; priceMinor: number };
    });
    const bodies = await Promise.all(held.map((h) => stack.notice(h.id, h.priceMinor)));
    await burst(50, async (i) => {
      const body = bodies[i];
      if (body) await stack.notify(body, stack.URLS.api[i % 2]);
    });
    await stack.until(
      async () =>
        (await stack.db().enrollment.count({ where: { cohortId: cohort.id, status: 'paid' } })) ===
        50,
      'all 50 payments',
    );
    expect(
      await stack.db().enrollment.count({ where: { cohortId: cohort.id, priceMinor: 5_000 } }),
    ).toBe(10);
    const stored = await stack.db().promoCode.findUniqueOrThrow({ where: { id: promo.id } });
    expect([stored.usedCount, stored.reservedCount]).toEqual([10, 0]);
  });

  it('A-8 one notification sent 10 times to both copies is one payment; chaos refunds all arrive once', async () => {
    const owner = await stack.school();
    const cohort = await stack.cohort(owner, { capacity: 20 });
    const [first] = await stack.people(1);
    if (!first) throw new Error('fixture');
    const one = await stack.book(first, cohort.id);
    const body = await stack.notice(one);
    const replies = await burst(10, (i) => stack.notify(body, stack.URLS.api[i % 2]));
    expect(replies.map((r) => r.status)).toEqual(Array(10).fill(200));
    await stack.awaitStatus(one, 'paid');
    expect(await stack.db().moneyOperation.count({ where: { enrollmentId: one } })).toBe(1);

    await stack.stubControl({ chaos: true, lateProbability: 0, earlyRefundProbability: 0.5 });
    const crowd = await stack.people(15);
    const ids: string[] = [];
    for (const who of crowd) {
      const id = await stack.book(who, cohort.id);
      await stack.payNow(who, id);
      ids.push(id);
    }
    await burst(15, async (i) => crowd[i]?.http.post(`/api/enrollments/${ids[i] ?? ''}/cancel`));
    await stack.until(
      async () =>
        (await stack.db().refundRequest.count({
          where: { enrollmentId: { in: ids }, status: 'pending' },
        })) === 0,
      'every refund to arrive',
      150_000,
    );
    for (const id of ids) {
      const operations = await stack.db().moneyOperation.findMany({
        where: { enrollmentId: id },
        orderBy: { createdAt: 'asc' },
      });
      expect(operations.map((op) => op.kind).sort()).toEqual(['payment', 'refund']);
    }
    const atGateway = await stack.gatewayRefunds(ids);
    expect(atGateway).toHaveLength(15);
    expect(new Set(atGateway.map((r) => r.order_id)).size).toBe(15);
    await stack.stubControl({ chaos: false });
  });

  it('A-9 cancelling a minute before the start in New York returns 100 %, a minute after 50 %', async () => {
    const owner = await stack.school();
    for (const [offset, percent, amount] of [
      [-MINUTE, 100, 10_000],
      [MINUTE, 50, 5_000],
    ] as const) {
      await stack.resetClock();
      const cohort = await stack.cohort(owner, {
        timeZone: 'America/New_York',
        startsInDays: 10,
        lessons: 6,
      });
      const [who] = await stack.people(1);
      if (!who) throw new Error('fixture');
      const id = await stack.book(who, cohort.id);
      await stack.payNow(who, id);
      await stack.setClock(new Date(cohort.startsAt.getTime() + offset));
      // A fresh sign-in is not needed: tokens run on the wall clock.
      const preview = await who.http.get(`/api/enrollments/${id}/refund-preview`);
      expect(preview.body).toMatchObject({ percent, amountMinor: amount });
      await who.http.post(`/api/enrollments/${id}/cancel`);
      await stack.until(
        async () =>
          (await stack.db().moneyOperation.count({
            where: { enrollmentId: id, kind: 'refund', amountMinor: amount },
          })) === 1,
        'the refund',
      );
    }
    await stack.resetClock();
  });
});

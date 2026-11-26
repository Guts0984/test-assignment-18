import { assertInvariants } from '@school/db/invariants/assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOW, startApi, type TestApi } from '../attacker/app';
import { burst } from '../attacker/burst';
import { expectError } from '../attacker/expect';
import { expire, notify, paymentNotice, processAll, sellingCohort } from '../attacker/money';
import { students, type Student } from '../attacker/students';

let api: TestApi;
beforeAll(async () => {
  api = await startApi({ copies: 2 });
});
afterAll(async () => {
  await api.stop();
});

type Held = {
  id: string;
  priceMinor: number;
  listPriceMinor: number;
  promoCode: string | null;
  promoError: { code: string } | null;
};

const promoFor = (schoolId: string, extra: Record<string, unknown> = {}) =>
  api.db.promoCode.create({
    data: {
      schoolId,
      code: 'HALF',
      discountKind: 'percent',
      percent: 50,
      validFrom: new Date('2026-01-01'),
      validUntil: new Date('2027-01-01'),
      maxUses: 10,
      ...extra,
    },
  });

const holdWith = (people: readonly Student[], cohortId: string, promoCode?: string) =>
  burst(people.length, async (i) => {
    const person = people[i];
    if (!person) throw new Error('fixture');
    const reply = await person.http.post('/api/enrollments', {
      cohortId,
      ...(promoCode ? { promoCode } : {}),
    });
    return reply.body as Held;
  });

describe('promo limit', () => {
  it('discounts exactly 10 of 50 simultaneous payers', async () => {
    const { cohort, school } = await sellingCohort(api, { capacity: 60 });
    const promo = await promoFor(school.id);
    const people = await students(api, 50);
    const held = await holdWith(people, cohort.id, 'half');

    const discounted = held.filter((h) => h.promoCode === 'HALF');
    expect(discounted).toHaveLength(10);
    expect(new Set(discounted.map((h) => h.priceMinor))).toEqual(new Set([5_000]));
    const rest = held.filter((h) => h.promoCode === null);
    expect(new Set(rest.map((h) => h.priceMinor))).toEqual(new Set([10_000]));
    expect(new Set(rest.map((h) => h.promoError?.code))).toEqual(new Set(['PROMO_EXHAUSTED']));

    // All fifty pay at once, each the price fixed for them.
    await burst(held.length, (i) =>
      notify(
        api.copies[i % 2]?.url ?? api.url,
        paymentNotice({
          schoolId: school.id,
          orderId: held[i]?.id ?? '',
          amountMinor: held[i]?.priceMinor ?? 0,
        }),
      ),
    );
    expect(new Set(await processAll(api))).toEqual(new Set(['enrolled']));
    const stored = await api.db.promoCode.findUniqueOrThrow({ where: { id: promo.id } });
    expect([stored.usedCount, stored.reservedCount]).toEqual([10, 0]);
    expect(
      await api.db.enrollment.count({ where: { cohortId: cohort.id, priceMinor: 5_000 } }),
    ).toBe(10);
    await assertInvariants(api.db);
  });

  it('never exceeds the limit when 30 students apply the code to existing holds', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { cohort, school } = await sellingCohort(api, { capacity: 40 });
      const promo = await promoFor(school.id, { maxUses: 3 });
      const people = await students(api, 30);
      const held = await holdWith(people, cohort.id);
      const replies = await burst(30, (i) => {
        const person = people[i];
        if (!person) throw new Error('fixture');
        return person.http.post(`/api/enrollments/${held[i]?.id ?? ''}/promo`, { code: 'HALF' });
      });
      expect(replies.filter((r) => r.status === 200)).toHaveLength(3);
      for (const reply of replies.filter((r) => r.status !== 200)) {
        expectError(reply, 'PROMO_EXHAUSTED');
      }
      const stored = await api.db.promoCode.findUniqueOrThrow({ where: { id: promo.id } });
      expect(stored.reservedCount).toBe(3);
    }
    await assertInvariants(api.db);
  });

  it('gives a use back when a hold expires or is cancelled unpaid', async () => {
    api.clock.set(NOW);
    const { cohort, school } = await sellingCohort(api, { capacity: 10 });
    const promo = await promoFor(school.id, { maxUses: 1 });
    const [a, b, c] = await students(api, 3);
    if (!a || !b || !c) throw new Error('fixture');
    const counters = async () => {
      const row = await api.db.promoCode.findUniqueOrThrow({ where: { id: promo.id } });
      return [row.usedCount, row.reservedCount];
    };
    const [first] = await holdWith([a], cohort.id, 'HALF');
    expect(await counters()).toEqual([0, 1]);
    api.clock.advance(900_000);
    await expire(api, first?.id ?? '');
    expect(await counters()).toEqual([0, 0]);

    const [second] = await holdWith([b], cohort.id, 'HALF');
    expect(second?.promoCode).toBe('HALF');
    await b.http.post(`/api/enrollments/${second?.id ?? ''}/cancel`);
    expect(await counters()).toEqual([0, 0]);
    const [third] = await holdWith([c], cohort.id, 'HALF');
    expect(third?.promoCode).toBe('HALF');

    // The expired holder pays late, after the only use went to someone else: full refund.
    await notify(
      api.url,
      paymentNotice({ schoolId: school.id, orderId: first?.id ?? '', amountMinor: 5_000 }),
    );
    expect(await processAll(api)).toEqual(['refunding_late']);
    expect(await counters()).toEqual([0, 1]);
    await assertInvariants(api.db);
  });

  it('fixes the price at booking, whatever the manager changes later', async () => {
    api.clock.set(NOW);
    const { cohort, school } = await sellingCohort(api);
    const [a] = await students(api, 1);
    const [held] = await holdWith(a ? [a] : [], cohort.id);
    await api.db.cohort.update({ where: { id: cohort.id }, data: { priceMinor: 99_999 } });
    await notify(
      api.url,
      paymentNotice({ schoolId: school.id, orderId: held?.id ?? '', amountMinor: 10_000 }),
    );
    expect(await processAll(api)).toEqual(['enrolled']);
  });

  it('rejects codes that are unknown, foreign, expired, early, wrong-currency or stacked', async () => {
    api.clock.set(NOW);
    const { cohort, school } = await sellingCohort(api);
    const other = await sellingCohort(api);
    await promoFor(other.school.id, { code: 'FOREIGN' });
    await promoFor(school.id, { code: 'OLD', validUntil: NOW });
    await promoFor(school.id, { code: 'SOON', validFrom: new Date(NOW.getTime() + 1_000) });
    await promoFor(school.id, {
      code: 'EUROS',
      discountKind: 'fixed',
      percent: null,
      amountMinor: 100,
      currency: 'EUR',
    });
    await promoFor(school.id, { code: 'GOOD' });
    await promoFor(school.id, { code: 'MORE' });
    const [a] = await students(api, 1);
    if (!a) throw new Error('fixture');
    const [held] = await holdWith([a], cohort.id);
    const apply = (code: string) =>
      a.http.post(`/api/enrollments/${held?.id ?? ''}/promo`, { code });
    expectError(await apply('NOPE'), 'PROMO_NOT_FOUND');
    expectError(await apply('FOREIGN'), 'PROMO_NOT_FOUND');
    expectError(await apply('OLD'), 'PROMO_EXPIRED');
    expectError(await apply('SOON'), 'PROMO_NOT_STARTED');
    expectError(await apply('EUROS'), 'PROMO_CURRENCY_MISMATCH');
    expectError(await apply("X'; DROP TABLE promo_codes;--"), 'VALIDATION_FAILED');
    expect((await apply('GOOD')).status).toBe(200);
    expectError(await apply('MORE'), 'PROMO_ALREADY_APPLIED');
    expectError(await apply('GOOD'), 'PROMO_ALREADY_APPLIED');
    await assertInvariants(api.db);
  });

  it('enrolls at once when the code brings the price to zero', async () => {
    api.clock.set(NOW);
    const { cohort, school } = await sellingCohort(api);
    await promoFor(school.id, { code: 'FREE', percent: 100 });
    const [a] = await students(api, 1);
    const [held] = await holdWith(a ? [a] : [], cohort.id, 'FREE');
    expect(held).toMatchObject({ priceMinor: 0, promoCode: 'FREE' });
    const row = await api.db.enrollment.findUniqueOrThrow({ where: { id: held?.id ?? '' } });
    expect(row.status).toBe('paid');
    await assertInvariants(api.db);
  });
});

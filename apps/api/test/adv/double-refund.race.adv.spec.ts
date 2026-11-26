import { assertInvariants } from '@school/db/invariants/assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOW, startApi, type TestApi } from '../attacker/app';
import { burst } from '../attacker/burst';
import { expectError } from '../attacker/expect';
import { pay, sellingCohort, siblingCohort } from '../attacker/money';
import { signedIn } from '../attacker/people';
import { signInAs, student } from '../attacker/students';

let api: TestApi;
beforeAll(async () => {
  api = await startApi({ copies: 2 });
});
afterAll(async () => {
  await api.stop();
});

const paidStudent = async () => {
  api.clock.set(NOW);
  const sale = await sellingCohort(api, { capacity: 3 });
  const buyer = await student(api);
  const held = await buyer.http.post('/api/enrollments', { cohortId: sale.cohort.id });
  const { id } = held.body as { id: string };
  await pay(api, sale.school.id, id);
  return { ...sale, buyer, id };
};

const managerOf = async (schoolId: string) => {
  const { user } = await signedIn(api, 'manager', schoolId);
  return signInAs(api, user.id, api.copies[1]?.url);
};

describe('one refund', () => {
  it('results when the student cancels while the manager excludes, twenty times', async () => {
    for (let round = 0; round < 20; round += 1) {
      const { buyer, id, school } = await paidStudent();
      const manager = await managerOf(school.id);
      const replies = await burst(6, (i) =>
        i % 2 === 0
          ? buyer.http.post(`/api/enrollments/${id}/cancel`)
          : manager.post(`/api/manager/enrollments/${id}/exclude`, { refundPolicy: 'full' }),
      );
      expect(replies.filter((r) => r.status < 300)).toHaveLength(1);
      for (const reply of replies.filter((r) => r.status >= 300)) {
        expectError(reply, 'INVALID_TRANSITION');
      }
      const refunds = await api.db.refundRequest.findMany({ where: { enrollmentId: id } });
      expect(refunds.map((r) => Number(r.amountMinor))).toEqual([10_000]);
      const releases = await api.db.seatJournal.count({
        where: { enrollmentId: id, seatsDelta: -1 },
      });
      expect(releases).toBe(1);
    }
    await assertInvariants(api.db);
  });

  it('cannot be raised by cancelling after a cheaper transfer', async () => {
    const base = await paidStudent();
    const cheaper = await siblingCohort(api, base, { priceMinor: 6_000 });
    const moved = await base.buyer.http.post(`/api/enrollments/${base.id}/transfer`, {
      targetCohortId: cheaper.id,
    });
    const { id: newId } = moved.body as { id: string };
    await burst(8, () => base.buyer.http.post(`/api/enrollments/${newId}/cancel`));
    expectError(
      await base.buyer.http.post(`/api/enrollments/${base.id}/cancel`),
      'INVALID_TRANSITION',
    );
    const refunds = await api.db.refundRequest.findMany({
      where: { enrollmentId: { in: [base.id, newId] } },
      orderBy: { amountMinor: 'asc' },
    });
    // The difference once, and the rest once: together exactly what was paid.
    expect(refunds.map((r) => Number(r.amountMinor))).toEqual([4_000, 6_000]);
    await assertInvariants(api.db);
  });
});

describe('refund amount', () => {
  it.each([
    ['one minute before the start', -60_000, 100, 10_000, 'refunded'],
    ['at the start', 0, 50, 5_000, 'refunded'],
    ['one minute after the start', 60_000, 50, 5_000, 'refunded'],
    ['at the third lesson', 14 * 86_400_000, 0, 0, 'cancelled'],
  ])('in New York %s matches the preview', async (_name, offsetMs, percent, amount, status) => {
    const { buyer, id, cohort } = await paidStudent();
    await api.db.cohort.update({
      where: { id: cohort.id },
      data: { timeZone: 'America/New_York' },
    });
    const start = cohort.startsAt.getTime();
    await api.db.lesson.createMany({
      data: [0, 7, 14, 21].map((days, index) => ({
        cohortId: cohort.id,
        seq: index + 1,
        localDate: new Date(start + days * 86_400_000),
        localTime: '12:00',
        startsAt: new Date(start + days * 86_400_000),
        endsAt: new Date(start + days * 86_400_000 + 5_400_000),
      })),
    });
    api.clock.set(new Date(start + offsetMs));
    const preview = await buyer.http.get(`/api/enrollments/${id}/refund-preview`);
    expect(preview.body).toMatchObject({ percent, amountMinor: amount, paidMinor: 10_000 });
    const cancelled = await buyer.http.post(`/api/enrollments/${id}/cancel`);
    expect(cancelled.body).toMatchObject({ status });
    const refunds = await api.db.refundRequest.findMany({ where: { enrollmentId: id } });
    expect(refunds.reduce((sum, r) => sum + Number(r.amountMinor), 0)).toBe(amount);
    await assertInvariants(api.db);
  });

  it('can be the full amount when a manager chooses so after the start', async () => {
    const { id, school, cohort } = await paidStudent();
    api.clock.set(new Date(cohort.startsAt.getTime() + 90 * 86_400_000));
    const manager = await managerOf(school.id);
    const reply = await manager.post(`/api/manager/enrollments/${id}/exclude`, {
      refundPolicy: 'full',
    });
    expect(reply.status).toBe(204);
    const refunds = await api.db.refundRequest.findMany({ where: { enrollmentId: id } });
    expect(refunds.map((r) => [r.reason, Number(r.amountMinor)])).toEqual([['exclude', 10_000]]);
  });
});

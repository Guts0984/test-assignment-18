import { assertInvariants } from '@school/db/invariants/assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from './attacker/app';
import { sellingCohort } from './attacker/money';
import { students } from './attacker/students';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.stop();
});

type View = { id: string; status: string; priceMinor: number };

describe('a free cohort', () => {
  it('enrolls at once, from a booking and from the waiting list', async () => {
    const sale = await sellingCohort(api, { capacity: 1, priceMinor: 0 });
    const [first, second] = await students(api, 2);
    if (!first || !second) throw new Error('fixture');
    const booked = await first.http.post('/api/enrollments', { cohortId: sale.cohort.id });
    expect(booked.body).toMatchObject({ status: 'paid', priceMinor: 0, holdExpiresAt: null });
    // Asking again does not make a second one.
    const again = await first.http.post('/api/enrollments', { cohortId: sale.cohort.id });
    expect(again.body).toMatchObject({ code: 'ALREADY_ENROLLED' });
    await second.http.post(`/api/waitlist/${sale.cohort.id}`);

    const { id } = booked.body as View;
    const cancelled = await first.http.post(`/api/enrollments/${id}/cancel`);
    expect(cancelled.body).toMatchObject({ status: 'cancelled' });
    const offered = await api.db.enrollment.findFirstOrThrow({
      where: { studentId: second.id },
    });
    expect(offered.status).toBe('paid');
    expect(await api.db.moneyOperation.count({ where: { enrollmentId: offered.id } })).toBe(0);
    expect(await api.db.emailOutbox.count({ where: { dedupeKey: `paid:${offered.id}` } })).toBe(1);
    const entry = await api.db.waitlistEntry.findFirstOrThrow({
      where: { studentId: second.id },
    });
    expect(entry.status).toBe('converted');
    const journal = await api.db.seatJournal.findMany({
      where: { enrollmentId: offered.id },
      orderBy: { id: 'asc' },
    });
    expect(journal.map((row) => [row.reason, row.seatsDelta])).toEqual([
      ['offer', 1],
      ['payment', 0],
    ]);
    await assertInvariants(api.db);
  });
});

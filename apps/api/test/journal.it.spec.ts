import { assertInvariants } from '@school/db/invariants/assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOW, startApi, type TestApi } from './attacker/app';
import { expire, pay, sellingCohort, siblingCohort } from './attacker/money';
import { signedIn } from './attacker/people';
import { students } from './attacker/students';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.stop();
});

describe('seat journal', () => {
  it('records every kind of change as its own row: cohort, delta, enrollment, who and when', async () => {
    const sale = await sellingCohort(api, { capacity: 2 });
    const next = await siblingCohort(api, sale);
    const manager = await signedIn(api, 'manager', sale.school.id);
    const [mover, leaver, expiring, waiter] = await students(api, 4);
    if (!mover || !leaver || !expiring || !waiter) throw new Error('fixture');
    const hold = async (who: typeof mover) =>
      (
        (await who.http.post('/api/enrollments', { cohortId: sale.cohort.id })).body as {
          id: string;
        }
      ).id;

    const moving = await hold(mover);
    await pay(api, sale.school.id, moving);
    const leaving = await hold(leaver);
    await pay(api, sale.school.id, leaving);
    await waiter.http.post(`/api/waitlist/${sale.cohort.id}`);
    // Capacity up: the new seat is offered to the waiter.
    await manager.http.patch(`/api/manager/cohorts/${sale.cohort.id}/capacity`, { capacity: 3 });
    const offer = await api.db.enrollment.findFirstOrThrow({
      where: { studentId: waiter.id, status: 'offered' },
    });
    await mover.http.post(`/api/enrollments/${moving}/transfer`, { targetCohortId: next.id });
    await manager.http.post(`/api/manager/enrollments/${leaving}/exclude`, {
      refundPolicy: 'rule',
    });
    const short = await hold(expiring);
    api.clock.advance(900_000);
    await expire(api, short);
    await waiter.http.post(`/api/enrollments/${offer.id}/cancel`);

    const rows = await api.db.seatJournal.findMany({
      where: { cohortId: sale.cohort.id },
      orderBy: { id: 'asc' },
    });
    expect(rows.map((r) => [r.reason, r.seatsDelta, r.capacityDelta, r.actorKind])).toEqual([
      ['capacity', 0, 2, 'system'],
      ['hold', 1, 0, 'student'],
      ['payment', 0, 0, 'system'],
      ['hold', 1, 0, 'student'],
      ['payment', 0, 0, 'system'],
      ['capacity', 0, 1, 'manager'],
      ['offer', 1, 0, 'system'],
      ['transfer_out', -1, 0, 'student'],
      ['exclude', -1, 0, 'manager'],
      ['hold', 1, 0, 'student'],
      ['expiry', -1, 0, 'system'],
      ['cancel', -1, 0, 'student'],
    ]);
    expect(rows.filter((r) => r.reason === 'capacity').every((r) => r.enrollmentId === null)).toBe(
      true,
    );
    expect(rows.find((r) => r.reason === 'exclude')?.actorId).toBe(manager.user.id);
    expect(rows[1]?.at).toEqual(NOW);
    const incoming = await api.db.seatJournal.findMany({ where: { cohortId: next.id } });
    expect(incoming.map((r) => r.reason)).toEqual(['capacity', 'transfer_in']);
    await assertInvariants(api.db);
  });
});

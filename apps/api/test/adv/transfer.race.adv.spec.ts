import { assertInvariants } from '@school/db/invariants/assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOW, startApi, type TestApi } from '../attacker/app';
import { burst } from '../attacker/burst';
import { expectError } from '../attacker/expect';
import { expire, pay, sellingCohort, siblingCohort } from '../attacker/money';
import { student, students } from '../attacker/students';

let api: TestApi;
beforeAll(async () => {
  api = await startApi({ copies: 2 });
});
afterAll(async () => {
  await api.stop();
});

type View = { id: string; status: string; priceMinor: number; cohortId: string };

const setup = async (
  target: { priceMinor?: number; capacity?: number; currency?: string } = {},
) => {
  api.clock.set(NOW);
  const base = await sellingCohort(api, { capacity: 3 });
  const mover = await student(api);
  const held = await mover.http.post('/api/enrollments', { cohortId: base.cohort.id });
  const { id } = held.body as View;
  await pay(api, base.school.id, id);
  const next = await siblingCohort(api, base, target);
  const move = () =>
    mover.http.post(`/api/enrollments/${id}/transfer`, { targetCohortId: next.id });
  return { ...base, mover, id, next, move };
};

const activeIn = async (studentId: string) =>
  (
    await api.db.enrollment.findMany({
      where: { studentId, status: 'paid' },
      select: { cohortId: true },
    })
  ).map((row) => row.cohortId);

const seats = async (id: string) =>
  (await api.db.cohort.findUniqueOrThrow({ where: { id } })).seatsTaken;

describe('transfer racing for the last seat', () => {
  it('leaves the student in exactly one cohort, twenty times over', async () => {
    const winners = new Set<string>();
    for (let round = 0; round < 20; round += 1) {
      const { mover, cohort, next, move } = await setup({ capacity: 1 });
      const rivals = await students(api, 3);
      const results = await burst(4, async (i) => {
        if (i === round % 4) return move();
        const rival = rivals[i > round % 4 ? i - 1 : i];
        if (!rival) throw new Error('fixture');
        return rival.http.post('/api/enrollments', { cohortId: next.id });
      });
      const places = await activeIn(mover.id);
      expect(places).toHaveLength(1);
      expect(await seats(next.id)).toBe(1);
      const moved = places[0] === next.id;
      winners.add(moved ? 'transfer' : 'rival');
      expect(await seats(cohort.id)).toBe(moved ? 0 : 1);
      const own = results[round % 4];
      if (!moved && own) expectError(own, 'NO_SEATS');
    }
    expect(winners.size).toBeGreaterThan(0);
    await assertInvariants(api.db);
  });

  it('survives simultaneous transfers in opposite directions without deadlock', async () => {
    const left = await setup();
    const other = await student(api);
    const held = await other.http.post('/api/enrollments', { cohortId: left.next.id });
    const { id } = held.body as View;
    await pay(api, left.school.id, id);
    const [a, b] = await Promise.all([
      left.move(),
      other.http.post(`/api/enrollments/${id}/transfer`, { targetCohortId: left.cohort.id }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await activeIn(left.mover.id)).toEqual([left.next.id]);
    expect(await activeIn(other.id)).toEqual([left.cohort.id]);
    await assertInvariants(api.db);
  });

  it('ends consistently when raced against the student’s own cancellation', async () => {
    for (let round = 0; round < 15; round += 1) {
      const { mover, id, move } = await setup({ priceMinor: 8_000 });
      await burst(2, (i) =>
        i === round % 2 ? move() : mover.http.post(`/api/enrollments/${id}/cancel`),
      );
      const rows = await api.db.enrollment.findMany({ where: { studentId: mover.id } });
      const paid = rows.filter((r) => r.status === 'paid');
      const refunds = await api.db.refundRequest.findMany({
        where: { enrollmentId: { in: rows.map((r) => r.id) } },
      });
      const returned = refunds.reduce((sum, r) => sum + Number(r.amountMinor), 0);
      expect(paid.length).toBeLessThanOrEqual(1);
      expect(returned).toBe(paid.length === 1 ? 2_000 : 10_000);
    }
    await assertInvariants(api.db);
  });
});

describe('transfer money', () => {
  it('moves at once and refunds the difference to a cheaper cohort', async () => {
    const { mover, id, next, cohort, move } = await setup({ priceMinor: 7_000 });
    const reply = await move();
    expect(reply.body).toMatchObject({ status: 'paid', cohortId: next.id, paidMinor: 7_000 });
    const old = await mover.http.get(`/api/enrollments/${id}`);
    expect(old.body).toMatchObject({ status: 'transferred', paidMinor: 3_000 });
    const refunds = await api.db.refundRequest.findMany({ where: { enrollmentId: id } });
    expect(refunds.map((r) => [r.reason, Number(r.amountMinor)])).toEqual([['transfer', 3_000]]);
    expect(await seats(cohort.id)).toBe(0);
    await assertInvariants(api.db);
  });

  it('holds the new seat for a surcharge and moves only once it is paid', async () => {
    const { mover, id, next, cohort, school, move } = await setup({ priceMinor: 14_000 });
    const reply = await move();
    const pending = reply.body as View;
    expect(pending).toMatchObject({ status: 'held', priceMinor: 4_000, transferFromId: id });
    expect(await activeIn(mover.id)).toEqual([cohort.id]);
    expect((await move()).body).toMatchObject({ id: pending.id });
    await pay(api, school.id, pending.id);
    expect(await activeIn(mover.id)).toEqual([next.id]);
    const paid = await mover.http.get(`/api/enrollments/${pending.id}`);
    expect(paid.body).toMatchObject({ paidMinor: 14_000 });
    expect(await seats(cohort.id)).toBe(0);
    await assertInvariants(api.db);
  });

  it('leaves the student in place when the surcharge hold expires', async () => {
    const { mover, cohort, next, school, move } = await setup({ priceMinor: 14_000 });
    const pending = (await move()).body as View;
    api.clock.advance(900_000);
    await expire(api, pending.id);
    expect(await activeIn(mover.id)).toEqual([cohort.id]);
    expect(await seats(next.id)).toBe(0);

    // The surcharge then arrives late while the seat is still free: the move completes.
    await pay(api, school.id, pending.id);
    expect(await activeIn(mover.id)).toEqual([next.id]);
    await assertInvariants(api.db);
  });

  it('returns a surcharge paid after the old enrollment was cancelled', async () => {
    const { mover, id, next, school, move } = await setup({ priceMinor: 14_000 });
    const pending = (await move()).body as View;
    await mover.http.post(`/api/enrollments/${id}/cancel`);
    expect(await seats(next.id)).toBe(0);
    await pay(api, school.id, pending.id);
    expect(await activeIn(mover.id)).toEqual([]);
    const refunds = await api.db.refundRequest.findMany({
      where: { enrollmentId: pending.id },
    });
    expect(refunds.map((r) => Number(r.amountMinor))).toEqual([4_000]);
    await assertInvariants(api.db);
  });

  it('is refused for another currency, course, a started cohort or an unpaid enrollment', async () => {
    const euros = await setup({ currency: 'EUR' });
    expectError(await euros.move(), 'TRANSFER_CURRENCY_MISMATCH');
    const foreign = await sellingCohort(api);
    const to = (targetCohortId: string) =>
      euros.mover.http.post(`/api/enrollments/${euros.id}/transfer`, { targetCohortId });
    expectError(await to(foreign.cohort.id), 'TRANSFER_NOT_ALLOWED');
    expectError(await to(euros.cohort.id), 'TRANSFER_NOT_ALLOWED');
    const started = await siblingCohort(api, euros, { startsAt: NOW });
    expectError(await to(started.id), 'ENROLLMENT_CLOSED');
    const unpaid = await student(api);
    const held = await unpaid.http.post('/api/enrollments', { cohortId: euros.cohort.id });
    const sibling = await siblingCohort(api, euros);
    expectError(
      await unpaid.http.post(`/api/enrollments/${(held.body as View).id}/transfer`, {
        targetCohortId: sibling.id,
      }),
      'TRANSFER_NOT_ALLOWED',
    );
    await assertInvariants(api.db);
  });
});

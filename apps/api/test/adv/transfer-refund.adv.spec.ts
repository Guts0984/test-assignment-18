import { assertInvariants } from '@school/db/invariants/assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOW, startApi, type TestApi } from '../attacker/app';
import { expectError } from '../attacker/expect';
import { expire, pay, sellingCohort, siblingCohort } from '../attacker/money';
import { signedIn } from '../attacker/people';
import { student } from '../attacker/students';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.stop();
});

const DAY = 86_400_000;
type View = { id: string; status: string };

/** A paid student in a cohort with six weekly lessons, and a later cohort to move to. */
const setup = async (targetPrice = 32_000) => {
  api.clock.set(NOW);
  const base = await sellingCohort(api, { capacity: 5, priceMinor: 32_000 });
  const start = base.cohort.startsAt.getTime();
  await api.db.lesson.createMany({
    data: Array.from({ length: 6 }, (_, i) => ({
      cohortId: base.cohort.id,
      seq: i + 1,
      localDate: new Date(start + i * 7 * DAY),
      localTime: '19:00',
      startsAt: new Date(start + i * 7 * DAY),
      endsAt: new Date(start + i * 7 * DAY + 5_400_000),
    })),
  });
  const later = await siblingCohort(api, base, {
    priceMinor: targetPrice,
    startsAt: new Date(start + 120 * DAY),
  });
  const mover = await student(api);
  const held = await mover.http.post('/api/enrollments', { cohortId: base.cohort.id });
  const { id } = held.body as View;
  await pay(api, base.school.id, id);
  const move = () =>
    mover.http.post(`/api/enrollments/${id}/transfer`, { targetCohortId: later.id });
  const returned = async () => {
    const rows = await api.db.refundRequest.findMany({
      where: { enrollment: { studentId: mover.id } },
    });
    return rows.reduce((sum, row) => sum + Number(row.amountMinor), 0);
  };
  return { ...base, later, mover, id, move, returned, start };
};

const cancel = (who: Awaited<ReturnType<typeof setup>>, id: string) =>
  who.mover.http.post(`/api/enrollments/${id}/cancel`);

describe('transfer and the refund rule', () => {
  it.each([32_000, 1_000])(
    'refuses a student who is past the third lesson, moving to a cohort at %d',
    async (price) => {
      const run = await setup(price);
      api.clock.set(new Date(run.start + 30 * DAY));
      expectError(await run.move(), 'TRANSFER_NOT_ALLOWED');
      expect(
        (await run.mover.http.get(`/api/enrollments/${run.id}/transfer-options`)).body,
      ).toEqual({ items: [] });
      await cancel(run, run.id);
      expect(await run.returned()).toBe(0);
      await assertInvariants(api.db);
    },
  );

  it.each([
    ['at the start', 0, 50],
    ['after the third lesson', 30 * DAY, 0],
  ])('carries the position of a manager’s transfer made %s', async (_name, offset, percent) => {
    const run = await setup();
    api.clock.set(new Date(run.start + offset));
    const manager = await signedIn(api, 'manager', run.school.id);
    const moved = await manager.http.post(`/api/manager/enrollments/${run.id}/transfer`, {
      targetCohortId: run.later.id,
    });
    const { enrollmentId } = moved.body as { enrollmentId: string };
    // The new cohort has not started, yet nothing more than before can come back.
    const preview = await run.mover.http.get(`/api/enrollments/${enrollmentId}/refund-preview`);
    expect(preview.body).toMatchObject({ percent, amountMinor: (32_000 * percent) / 100 });
    await cancel(run, enrollmentId);
    expect(await run.returned()).toBe((32_000 * percent) / 100);
    await assertInvariants(api.db);
  });

  it('keeps the full refund for a transfer made before the start', async () => {
    const run = await setup();
    const { id } = (await run.move()).body as View;
    await cancel(run, id);
    expect(await run.returned()).toBe(32_000);
  });

  it('does not complete a surcharge paid late, after the old cohort started', async () => {
    const run = await setup(40_000);
    const pending = (await run.move()).body as View;
    api.clock.advance(900_000);
    await expire(api, pending.id);
    api.clock.set(new Date(run.start + 30 * DAY));
    await pay(api, run.school.id, pending.id);
    const rows = await api.db.enrollment.findMany({ where: { studentId: run.mover.id } });
    expect(rows.find((r) => r.id === run.id)?.status).toBe('paid');
    expect(rows.find((r) => r.id === pending.id)?.status).toBe('refunded');
    await cancel(run, run.id);
    // Only the surcharge itself comes back.
    expect(await run.returned()).toBe(8_000);
    await assertInvariants(api.db);
  });

  it('applies the position at the moment a surcharge is paid', async () => {
    const run = await setup(40_000);
    api.clock.set(new Date(run.start - 60_000));
    const pending = (await run.move()).body as View;
    api.clock.set(new Date(run.start + 60_000));
    await pay(api, run.school.id, pending.id);
    await cancel(run, pending.id);
    expect(await run.returned()).toBe(20_000);
    await assertInvariants(api.db);
  });
});

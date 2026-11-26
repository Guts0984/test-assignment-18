import { assertInvariants } from '@school/db/invariants/assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOW, startApi, type TestApi } from '../attacker/app';
import { burst } from '../attacker/burst';
import { expectError } from '../attacker/expect';
import { expire, notify, paymentNotice, processAll, sellingCohort } from '../attacker/money';
import { student, students } from '../attacker/students';

let api: TestApi;
beforeAll(async () => {
  api = await startApi({ copies: 2 });
});
afterAll(async () => {
  await api.stop();
});

const HOLD_MS = 900_000;

const holdOne = async (capacity = 1) => {
  api.clock.set(NOW);
  const { cohort, school } = await sellingCohort(api, { capacity });
  const buyer = await student(api);
  const reply = await buyer.http.post('/api/enrollments', { cohortId: cohort.id });
  const enrollment = reply.body as { id: string; holdExpiresAt: string };
  const notice = paymentNotice({
    schoolId: school.id,
    orderId: enrollment.id,
    amountMinor: cohort.priceMinor,
  });
  return { cohort, school, buyer, enrollment, notice };
};

const outcomeOf = async (enrollmentId: string) => {
  const row = await api.db.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    include: { refundRequests: true, operations: true },
  });
  return {
    status: row.status,
    payments: row.operations.filter((op) => op.kind === 'payment').length,
    refunds: row.refundRequests.map((r) => Number(r.amountMinor)),
  };
};

describe('hold expiry boundary', () => {
  it('keeps the seat one second before 15 minutes and releases it from the instant', async () => {
    const { enrollment, cohort } = await holdOne();
    expect(Date.parse(enrollment.holdExpiresAt) - NOW.getTime()).toBe(HOLD_MS);
    const seats = async () =>
      (await api.db.cohort.findUniqueOrThrow({ where: { id: cohort.id } })).seatsTaken;
    api.clock.set(new Date(NOW.getTime() + HOLD_MS - 1_000));
    await expire(api, enrollment.id);
    expect(await seats()).toBe(1);
    api.clock.set(new Date(NOW.getTime() + HOLD_MS));
    await expire(api, enrollment.id);
    expect(await seats()).toBe(0);
  });

  it('returns the seat exactly once however many expiry jobs run', async () => {
    const { enrollment, cohort } = await holdOne();
    api.clock.set(new Date(NOW.getTime() + HOLD_MS + 1_000));
    await burst(15, () => expire(api, enrollment.id));
    const rows = await api.db.seatJournal.findMany({
      where: { enrollmentId: enrollment.id },
      orderBy: { id: 'asc' },
    });
    expect(rows.map((row) => [row.reason, row.seatsDelta])).toEqual([
      ['hold', 1],
      ['expiry', -1],
    ]);
    expect((await api.db.cohort.findUniqueOrThrow({ where: { id: cohort.id } })).seatsTaken).toBe(
      0,
    );
    await assertInvariants(api.db);
  });
});

describe('payment at the moment of expiry', () => {
  it('enrolls or refunds, never both and never neither, with a rival after the seat', async () => {
    const seen = new Set<string>();
    for (let round = 0; round < 20; round += 1) {
      const { cohort, enrollment, notice } = await holdOne();
      const rival = await student(api);
      // Just before, exactly at, and just after the expiry instant.
      api.clock.set(new Date(Date.parse(enrollment.holdExpiresAt) + ((round % 3) - 1)));
      await notify(api.url, notice);
      const [, , rivalReply] = await Promise.all([
        processAll(api),
        expire(api, enrollment.id),
        rival.http.post('/api/enrollments', { cohortId: cohort.id }),
      ]);
      const outcome = await outcomeOf(enrollment.id);
      expect(outcome.payments).toBe(1);
      if (outcome.status === 'paid') {
        expect(outcome.refunds).toEqual([]);
        expectError(rivalReply, 'NO_SEATS');
      } else {
        expect(outcome).toMatchObject({ status: 'refunded', refunds: [cohort.priceMinor] });
        expect(rivalReply.status).toBe(201);
      }
      seen.add(outcome.status);
    }
    // Both branches really ran: before the instant the payer wins, after it the rival may.
    expect([...seen].sort()).toEqual(['paid', 'refunded']);
    await assertInvariants(api.db);
  });

  it('enrolls a late payer while the seat is still free', async () => {
    const { enrollment, notice } = await holdOne();
    api.clock.advance(HOLD_MS + 20 * 60_000);
    await expire(api, enrollment.id);
    await notify(api.url, notice);
    expect(await processAll(api)).toEqual(['enrolled_late']);
    expect(await outcomeOf(enrollment.id)).toEqual({ status: 'paid', payments: 1, refunds: [] });
    await assertInvariants(api.db);
  });

  it('refunds a late payer whose seat is gone, in full and once', async () => {
    const { cohort, enrollment, notice } = await holdOne();
    api.clock.advance(HOLD_MS + 1);
    const [other] = await students(api, 1);
    expect((await other?.http.post('/api/enrollments', { cohortId: cohort.id }))?.status).toBe(201);
    await burst(10, (i) => notify(api.copies[i % 2]?.url ?? api.url, notice));
    await processAll(api);
    expect(await outcomeOf(enrollment.id)).toEqual({
      status: 'refunded',
      payments: 1,
      refunds: [cohort.priceMinor],
    });
    await assertInvariants(api.db);
  });

  it('refunds a payment for a cancelled hold', async () => {
    const { buyer, enrollment, notice, cohort } = await holdOne();
    await buyer.http.post(`/api/enrollments/${enrollment.id}/cancel`);
    await notify(api.url, notice);
    await processAll(api);
    expect(await outcomeOf(enrollment.id)).toMatchObject({
      status: 'refunded',
      refunds: [cohort.priceMinor],
    });
    await assertInvariants(api.db);
  });
});

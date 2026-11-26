import { assertInvariants } from '@school/db/invariants/assert';
import { cancelEnrollment } from '@school/db/repo/cancel';
import { recordPayment } from '@school/db/repo/payment';
import { joinWaitlist } from '@school/db/repo/waitlist';
import { createUser } from '@school/db/testing/factories';
import { SYSTEM_ACTOR } from '@school/db/repo/seat-journal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inbox } from '../mail';
import { pause, startRig, until, type Rig } from '../rig';

let rig: Rig;
beforeAll(async () => {
  rig = await startRig();
});
afterAll(async () => {
  await rig.stop();
});

describe('Redis wiped', () => {
  it('loses no hold, offer, notification, refund or email, and repeats nothing', async () => {
    const { cohort, school } = await rig.cohort(3);
    const [paid, cancelled, held] = await rig.holds(cohort.id, 3);
    if (!paid || !cancelled || !held) throw new Error('fixture');
    const waiter = await createUser(rig.db);
    await rig.unit((u) => joinWaitlist(u, { cohortId: cohort.id, studentId: waiter.id }));
    for (const enrollmentId of [paid, cancelled]) {
      await rig.unit((u) =>
        recordPayment(u, {
          enrollmentId,
          schoolId: school.id,
          providerPaymentId: `p-${enrollmentId}`,
          amountMinor: 10_000,
          currency: 'UAH',
        }),
      );
    }
    // The cancellation frees a seat: the waiter gets an offer, and a refund is owed.
    await rig.unit((u) =>
      cancelEnrollment(u, { enrollmentId: cancelled, actor: SYSTEM_ACTOR, policy: 'rule' }),
    );
    await rig.db.paymentNotification.create({
      data: {
        schoolId: school.id,
        providerEventId: 'stored-before-the-flush',
        kind: 'payment.failed',
        payload: {
          type: 'payment.failed',
          eventId: 'stored-before-the-flush',
          paymentId: 'x',
          schoolId: school.id,
          orderId: held,
          amountMinor: 1,
          currency: 'UAH',
          occurredAt: rig.start.toISOString(),
        },
        receivedAt: rig.start,
      },
    });
    // Nothing was ever published: as if every job had been lost with Redis.
    await rig.flushRedis();
    const worker = rig.startWorker();
    await pause(300);
    await rig.flushRedis();

    await until(
      async () =>
        (await rig.db.refundRequest.count({ where: { status: 'pending' } })) === 0 &&
        (await rig.db.paymentNotification.count({ where: { processedAt: null } })) === 0 &&
        (await rig.db.emailOutbox.count({ where: { status: { not: 'sent' } } })) === 0,
      'refund, notification and emails',
    );

    // Past the hold and then the offer, flushing in between.
    await rig.setTime(new Date(rig.start.getTime() + 901_000));
    await rig.flushRedis();
    await until(
      async () =>
        (await rig.db.enrollment.findUniqueOrThrow({ where: { id: held } })).status === 'expired',
      'the hold to expire',
    );
    await rig.setTime(new Date(rig.start.getTime() + 86_500_000));
    await rig.flushRedis();
    await until(
      async () =>
        (await rig.db.enrollment.count({ where: { cohortId: cohort.id, status: 'offered' } })) ===
        0,
      'the offer to expire',
    );
    await until(
      async () => (await rig.db.emailOutbox.count({ where: { status: { not: 'sent' } } })) === 0,
      'the emails',
    );
    await rig.kill(worker);

    expect(
      await rig.db.moneyOperation.count({ where: { enrollmentId: cancelled, kind: 'refund' } }),
    ).toBe(1);
    const gateway = await rig.stub.pool.query('SELECT * FROM refunds WHERE order_id = $1', [
      cancelled,
    ]);
    expect(gateway.rowCount).toBe(1);
    for (const id of [held]) {
      expect(
        await rig.db.seatJournal.count({ where: { enrollmentId: id, reason: 'expiry' } }),
      ).toBe(1);
    }
    // Offers: the first waiter once, nobody twice.
    expect(
      await rig.db.enrollment.count({ where: { cohortId: cohort.id, studentId: waiter.id } }),
    ).toBe(1);
    const offers = (await inbox(waiter.email)).filter((m) => m.Subject.startsWith('A seat'));
    expect(offers).toHaveLength(1);
    expect(await rig.db.jobFailure.count()).toBe(0);
    await assertInvariants(rig.db);
  });
});

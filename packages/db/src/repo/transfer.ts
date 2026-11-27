import { holdExpiryJob } from '@school/shared/jobs/job';
import { type Unit } from './context';
import { requestRefund } from './cancel';
import { lockEnrollment } from './locks';
import { openCohorts } from './open-cohorts';
import { closeTransferSource, moveCredit, spendableBalance } from './payment-confirm';
import { journalSeats, type ActorRef } from './seat-journal';
import { hasOpenSeat, occupancyOf } from './seats';

export type TransferRejection =
  | 'NOT_FOUND'
  | 'TRANSFER_NOT_ALLOWED'
  | 'TRANSFER_CURRENCY_MISMATCH'
  | 'ENROLLMENT_CLOSED'
  | 'ALREADY_ENROLLED'
  | 'NO_SEATS';

export type TransferOutcome =
  { readonly enrollmentId: string; readonly surchargeMinor: number } | TransferRejection;

/**
 * Moves a paid student to another cohort of the same course, in one transaction. With nothing
 * to add, the new seat is taken and the old one freed here, and any difference is refunded. With
 * a surcharge, the new seat is held and both happen when it is paid; until then the student
 * stays where they are.
 */
export const transferEnrollment = async (
  unit: Unit,
  input: {
    readonly enrollmentId: string;
    readonly targetCohortId: string;
    readonly actor: ActorRef;
  },
): Promise<TransferOutcome> => {
  const found = await unit.tx.enrollment.findUnique({ where: { id: input.enrollmentId } });
  if (!found) return 'NOT_FOUND';
  const targetExists = await unit.tx.cohort.findUnique({ where: { id: input.targetCohortId } });
  if (!targetExists) return 'NOT_FOUND';
  const read = await openCohorts(unit, [found.cohortId, input.targetCohortId]);
  const source = await lockEnrollment(unit.tx, found.id);
  const from = await read(source.cohortId);
  const to = await read(input.targetCohortId);
  if (source.status !== 'paid' || from.id === to.id) return 'TRANSFER_NOT_ALLOWED';
  if (to.courseId !== from.courseId) return 'TRANSFER_NOT_ALLOWED';
  if (to.currency !== source.currency) return 'TRANSFER_CURRENCY_MISMATCH';

  const pending = await unit.tx.enrollment.findFirst({
    where: { transferFromId: source.id, status: 'held' },
  });
  if (pending) {
    return pending.cohortId === to.id
      ? { enrollmentId: pending.id, surchargeMinor: pending.priceMinor }
      : 'TRANSFER_NOT_ALLOWED';
  }
  // Once the student's own cohort has started, a move could be used to get back money the
  // refund rule keeps, so only a manager decides it.
  if (input.actor.kind === 'student' && from.startsAt <= unit.now) return 'TRANSFER_NOT_ALLOWED';
  if (to.startsAt <= unit.now) return 'ENROLLMENT_CLOSED';
  const active = await unit.tx.enrollment.findFirst({
    where: {
      cohortId: to.id,
      studentId: source.studentId,
      status: { in: ['held', 'offered', 'paid', 'completed'] },
    },
  });
  if (active) return 'ALREADY_ENROLLED';
  if (!hasOpenSeat(await occupancyOf(unit, to.id))) return 'NO_SEATS';

  const credit = await spendableBalance(unit, source.id);
  const difference = to.priceMinor - credit;
  const surcharge = Math.max(0, difference);
  const holdExpiresAt = new Date(unit.now.getTime() + unit.timings.holdTtlSec * 1000);
  const target = await unit.tx.enrollment.create({
    data: {
      cohortId: to.id,
      studentId: source.studentId,
      status: surcharge > 0 ? 'held' : 'paid',
      listPriceMinor: to.priceMinor,
      priceMinor: surcharge > 0 ? surcharge : to.priceMinor,
      currency: to.currency,
      holdExpiresAt,
      transferFromId: source.id,
      createdAt: unit.now,
      updatedAt: unit.now,
      paidAt: surcharge > 0 ? null : unit.now,
    },
  });
  await journalSeats(unit.tx, {
    cohortId: to.id,
    enrollmentId: target.id,
    seatsDelta: 1,
    reason: surcharge > 0 ? 'hold' : 'transfer_in',
    actor: input.actor,
    at: unit.now,
  });
  unit.touched.add(to.id);
  if (surcharge > 0) {
    unit.jobs.push(holdExpiryJob(target.id, holdExpiresAt));
    return { enrollmentId: target.id, surchargeMinor: surcharge };
  }
  await moveCredit(unit, {
    fromId: source.id,
    toId: target.id,
    amountMinor: Math.min(credit, to.priceMinor),
    currency: source.currency,
  });
  if (difference < 0) {
    await requestRefund(unit, {
      enrollment: source,
      amountMinor: -difference,
      reason: 'transfer',
      requestedById: input.actor.id,
    });
  }
  await closeTransferSource(unit, source, target.id, input.actor);
  return { enrollmentId: target.id, surchargeMinor: 0 };
};

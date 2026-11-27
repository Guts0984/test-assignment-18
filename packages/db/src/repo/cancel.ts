import { type Enrollment } from '@prisma/client';
import { refundJob } from '@school/shared/jobs/job';
import { refundAmount, type RefundPolicy } from '@school/shared/refund/refund';
import { type Tx } from '../client';
import { type Unit } from './context';
import { openCohorts } from './open-cohorts';
import { refundPercentOf } from './refund-percent';
import { lockEnrollment } from './locks';
import { spendableBalance } from './payment-confirm';
import { releasePromo } from './promo-use';
import { type ActorRef } from './seat-journal';
import { freeSeat } from './seats';
import { releaseReviewsOfEnrollment } from './review';

export const requestRefund = async (
  unit: Unit,
  input: {
    readonly enrollment: Enrollment;
    readonly amountMinor: number;
    readonly reason:
      'cancel' | 'exclude' | 'transfer' | 'late_payment' | 'duplicate_payment' | 'amount_mismatch';
    readonly requestedById: string | null;
    readonly sourcePaymentOperationId?: string;
  },
): Promise<void> => {
  const { enrollment, ...rest } = input;
  const request = await unit.tx.refundRequest.create({
    data: {
      ...rest,
      enrollmentId: enrollment.id,
      currency: enrollment.currency,
      createdAt: unit.now,
    },
  });
  unit.jobs.push(refundJob(request.id));
};

export type CancelRejection = 'NOT_FOUND' | 'INVALID_TRANSITION';

const pendingTransfersOf = (tx: Tx, enrollmentId: string) =>
  tx.enrollment.findMany({
    where: { transferFromId: enrollmentId, status: { in: ['held', 'offered'] } },
    select: { id: true, cohortId: true },
  });

/** Ends an unpaid enrollment: seat back, promo reservation released, nothing to refund. */
const cancelUnpaid = async (
  unit: Unit,
  enrollment: { readonly id: string; readonly cohortId: string },
  reason: 'cancel' | 'exclude',
  actor: ActorRef,
): Promise<void> => {
  await unit.tx.enrollment.update({
    where: { id: enrollment.id },
    data: { status: 'cancelled', updatedAt: unit.now },
  });
  await releasePromo(unit, enrollment.id);
  await unit.tx.waitlistEntry.updateMany({
    where: { enrollmentId: enrollment.id, status: 'offered' },
    data: { status: 'left' },
  });
  await freeSeat(unit, {
    cohortId: enrollment.cohortId,
    enrollmentId: enrollment.id,
    reason,
    actor,
  });
};

/**
 * Cancellation by the student, or exclusion by a manager. Concurrent calls serialize on the
 * cohort lock and the second finds nothing left to end, so there is at most one refund.
 */
export const cancelEnrollment = async (
  unit: Unit,
  input: {
    readonly enrollmentId: string;
    readonly actor: ActorRef;
    readonly policy: RefundPolicy;
  },
): Promise<'CANCELLED' | CancelRejection> => {
  const found = await unit.tx.enrollment.findUnique({ where: { id: input.enrollmentId } });
  if (!found) return 'NOT_FOUND';
  const children = await pendingTransfersOf(unit.tx, found.id);
  const read = await openCohorts(unit, [found.cohortId, ...children.map((c) => c.cohortId)]);
  const enrollment = await lockEnrollment(unit.tx, found.id);
  const reason = input.actor.kind === 'manager' ? 'exclude' : 'cancel';
  if (enrollment.status === 'held' || enrollment.status === 'offered') {
    await cancelUnpaid(unit, enrollment, reason, input.actor);
    return 'CANCELLED';
  }
  if (enrollment.status !== 'paid') return 'INVALID_TRANSITION';

  // A transfer waiting for its surcharge cannot outlive the enrollment it moves.
  for (const child of await pendingTransfersOf(unit.tx, enrollment.id)) {
    await cancelUnpaid(unit, child, reason, input.actor);
  }
  await releaseReviewsOfEnrollment(unit.tx, enrollment.id);
  const cohort = await read(enrollment.cohortId);
  const amountMinor = refundAmount({
    netPaidMinor: await spendableBalance(unit, enrollment.id),
    percent: await refundPercentOf(unit.tx, enrollment, cohort, unit.now),
    policy: input.policy,
  });
  if (amountMinor > 0) {
    await requestRefund(unit, {
      enrollment,
      amountMinor,
      reason,
      requestedById: input.actor.id,
    });
  }
  await unit.tx.enrollment.update({
    where: { id: enrollment.id },
    data: { status: amountMinor > 0 ? 'refunded' : 'cancelled', updatedAt: unit.now },
  });
  await freeSeat(unit, {
    cohortId: enrollment.cohortId,
    enrollmentId: enrollment.id,
    reason,
    actor: input.actor,
  });
  return 'CANCELLED';
};

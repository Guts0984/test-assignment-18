import { type Enrollment } from '@prisma/client';
import { type Unit } from './context';
import { markPaid } from './mark-paid';
import { refundPercentOf } from './refund-percent';
import { SYSTEM_ACTOR } from './seat-journal';
import { freeSeat } from './seats';
import { releaseReviewsOfEnrollment } from './review';

/** Money that can be given or moved: the balance less what is already being returned. */
export const spendableBalance = async (unit: Unit, enrollmentId: string): Promise<number> => {
  const enrollment = await unit.tx.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
  const pending = await unit.tx.refundRequest.aggregate({
    where: { enrollmentId, status: 'pending' },
    _sum: { amountMinor: true },
  });
  return Number(enrollment.balanceMinor - (pending._sum.amountMinor ?? 0n));
};

/** Moves money between two enrollments as a matching pair of operations. */
export const moveCredit = async (
  unit: Unit,
  input: {
    readonly fromId: string;
    readonly toId: string;
    readonly amountMinor: number;
    readonly currency: string;
  },
): Promise<void> => {
  if (input.amountMinor <= 0) return;
  const { amountMinor, currency } = input;
  const row = { amountMinor, currency, createdAt: unit.now };
  await unit.tx.moneyOperation.create({
    data: { ...row, enrollmentId: input.fromId, kind: 'transfer_out' },
  });
  await unit.tx.moneyOperation.create({
    data: { ...row, enrollmentId: input.toId, kind: 'transfer_in' },
  });
};

/**
 * Closes the source of a transfer once the new seat is secured: the new enrollment inherits what
 * could still be refunded, and the old seat is freed. Its cohort must be locked.
 */
export const closeTransferSource = async (
  unit: Unit,
  source: Enrollment,
  targetId: string,
  actor: Parameters<typeof freeSeat>[1]['actor'],
): Promise<void> => {
  const cohort = await unit.tx.cohort.findUniqueOrThrow({ where: { id: source.cohortId } });
  await unit.tx.enrollment.update({
    where: { id: targetId },
    data: {
      refundCapPercent: await refundPercentOf(unit.tx, source, cohort, unit.now),
    },
  });
  await unit.tx.enrollment.update({
    where: { id: source.id },
    data: { status: 'transferred', updatedAt: unit.now },
  });
  await releaseReviewsOfEnrollment(unit.tx, source.id);
  await freeSeat(unit, {
    cohortId: source.cohortId,
    enrollmentId: source.id,
    reason: 'transfer_out',
    actor,
  });
};

/**
 * A payment made good. For a transfer surcharge this also moves the money of the old enrollment
 * and frees the old seat.
 */
export const confirmPaid = async (
  unit: Unit,
  enrollment: Enrollment,
  source: Enrollment | null,
  seatsDelta: 0 | 1 = 0,
): Promise<void> => {
  await markPaid(unit, enrollment, seatsDelta);
  if (!source) return;
  await moveCredit(unit, {
    fromId: source.id,
    toId: enrollment.id,
    amountMinor: await spendableBalance(unit, source.id),
    currency: source.currency,
  });
  await closeTransferSource(unit, source, enrollment.id, SYSTEM_ACTOR);
};

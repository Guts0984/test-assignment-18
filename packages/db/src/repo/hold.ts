import { holdExpiryJob } from '@school/shared/jobs/job';
import { type Unit } from './context';
import { markPaid } from './mark-paid';
import { openCohorts } from './open-cohorts';
import { confirmPaid } from './payment-confirm';
import { reservePromo, type ApplyRejection } from './promo-use';
import { journalSeats } from './seat-journal';
import { hasOpenSeat, occupancyOf } from './seats';

export type HoldRejection = 'NOT_FOUND' | 'ENROLLMENT_CLOSED' | 'ALREADY_ENROLLED' | 'NO_SEATS';

export type HoldOutcome =
  { readonly enrollmentId: string; readonly promoRejected: ApplyRejection | null } | HoldRejection;

/** Applies a code to an unpaid enrollment; a price of zero enrolls at once. */
export const applyPromoToEnrollment = async (
  unit: Unit,
  input: { readonly enrollmentId: string; readonly code: string },
): Promise<ApplyRejection | null> => {
  const enrollment = await unit.tx.enrollment.findUniqueOrThrow({
    where: { id: input.enrollmentId },
    include: { cohort: true },
  });
  const result = await reservePromo(unit, {
    enrollment,
    cohort: enrollment.cohort,
    code: input.code,
  });
  if (typeof result === 'string') return result;
  if (result.priceMinor === 0) {
    await confirmPaid(
      unit,
      await unit.tx.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } }),
      null,
    );
  }
  return null;
};

/**
 * Books a seat for the hold period at the current price. Asking again returns the same hold.
 * Waiting students come first: a seat is open only if there are more free seats than waiters.
 */
export const holdSeat = async (
  unit: Unit,
  input: {
    readonly cohortId: string;
    readonly studentId: string;
    readonly promoCode: string | undefined;
  },
): Promise<HoldOutcome> => {
  const exists = await unit.tx.cohort.findUnique({ where: { id: input.cohortId } });
  if (!exists) return 'NOT_FOUND';
  const read = await openCohorts(unit, [input.cohortId]);
  const cohort = await read(input.cohortId);
  const active = await unit.tx.enrollment.findFirst({
    where: {
      cohortId: cohort.id,
      studentId: input.studentId,
      status: { in: ['held', 'offered', 'paid', 'completed'] },
    },
  });
  if (active) {
    if (active.status !== 'held' && active.status !== 'offered') return 'ALREADY_ENROLLED';
    return { enrollmentId: active.id, promoRejected: null };
  }
  if (cohort.startsAt <= unit.now) return 'ENROLLMENT_CLOSED';
  if (!hasOpenSeat(await occupancyOf(unit, cohort.id))) return 'NO_SEATS';

  const holdExpiresAt = new Date(unit.now.getTime() + unit.timings.holdTtlSec * 1000);
  const enrollment = await unit.tx.enrollment.create({
    data: {
      cohortId: cohort.id,
      studentId: input.studentId,
      status: 'held',
      listPriceMinor: cohort.priceMinor,
      priceMinor: cohort.priceMinor,
      currency: cohort.currency,
      holdExpiresAt,
      createdAt: unit.now,
      updatedAt: unit.now,
    },
  });
  await journalSeats(unit.tx, {
    cohortId: cohort.id,
    enrollmentId: enrollment.id,
    seatsDelta: 1,
    reason: 'hold',
    actor: { kind: 'student', id: input.studentId },
    at: unit.now,
  });
  unit.touched.add(cohort.id);
  if (cohort.priceMinor === 0) {
    // A free cohort needs no payment, and no promo code is spent on it.
    await markPaid(unit, enrollment);
    return { enrollmentId: enrollment.id, promoRejected: null };
  }
  unit.jobs.push(holdExpiryJob(enrollment.id, holdExpiresAt));
  const promoRejected =
    input.promoCode === undefined
      ? null
      : await applyPromoToEnrollment(unit, {
          enrollmentId: enrollment.id,
          code: input.promoCode,
        });
  return { enrollmentId: enrollment.id, promoRejected };
};

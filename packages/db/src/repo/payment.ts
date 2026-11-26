import { type Cohort, type Enrollment } from '@prisma/client';
import { type Unit } from './context';
import { requestRefund } from './cancel';
import { lockEnrollment } from './locks';
import { openCohorts } from './open-cohorts';
import { emailStudent } from './outbox';
import { confirmPaid } from './payment-confirm';
import { reacquirePromo } from './promo-use';
import { journalSeats, SYSTEM_ACTOR } from './seat-journal';
import { hasOpenSeat, occupancyOf } from './seats';

export type PaymentOutcome =
  | 'enrolled'
  | 'enrolled_late'
  | 'refunding_late'
  | 'refunding_duplicate'
  | 'refunding_amount'
  | 'already_recorded'
  | 'rejected_enrollment'
  | 'rejected_currency';

type Received = {
  readonly enrollmentId: string;
  readonly schoolId: string;
  readonly providerPaymentId: string;
  readonly amountMinor: number;
  readonly currency: string;
};

/** The old enrollment of a surcharge payment, if it is still there to move. */
const transferSource = async (
  unit: Unit,
  enrollment: Enrollment,
): Promise<{ readonly source: Enrollment | null; readonly gone: boolean }> => {
  if (enrollment.transferFromId === null) return { source: null, gone: false };
  const source = await lockEnrollment(unit.tx, enrollment.transferFromId);
  return source.status === 'paid' ? { source, gone: false } : { source: null, gone: true };
};

/** Sends a payment straight back; a never-paid ended enrollment is then marked refunded. */
const returnPayment = async (
  unit: Unit,
  enrollment: Enrollment,
  payment: { readonly id: string; readonly amountMinor: number },
  reason: 'late_payment' | 'duplicate_payment' | 'amount_mismatch',
): Promise<void> => {
  await requestRefund(unit, {
    enrollment,
    amountMinor: payment.amountMinor,
    reason,
    requestedById: null,
    sourcePaymentOperationId: payment.id,
  });
  const earlier = await unit.tx.moneyOperation.count({
    where: { enrollmentId: enrollment.id, kind: 'payment', id: { not: payment.id } },
  });
  const ended = enrollment.status === 'expired' || enrollment.status === 'cancelled';
  if (ended && earlier === 0) {
    await unit.tx.enrollment.update({
      where: { id: enrollment.id },
      data: { status: 'refunded', updatedAt: unit.now },
    });
    await journalSeats(unit.tx, {
      cohortId: enrollment.cohortId,
      enrollmentId: enrollment.id,
      seatsDelta: 0,
      reason: 'payment',
      actor: SYSTEM_ACTOR,
      at: unit.now,
    });
  }
  await emailStudent(unit, enrollment.studentId, {
    dedupeKey: `returned:${payment.id}`,
    subject: 'Your payment is being returned',
    body: 'We could not use your payment, so the full amount is being returned to you.',
  });
};

/** A payment that arrived after the hold ran out: enrol if a seat is still open. */
const honourLate = async (unit: Unit, enrollment: Enrollment, cohort: Cohort): Promise<boolean> => {
  if (cohort.startsAt <= unit.now) return false;
  const other = await unit.tx.enrollment.findFirst({
    where: {
      cohortId: cohort.id,
      studentId: enrollment.studentId,
      status: { in: ['held', 'offered', 'paid', 'completed'] },
    },
  });
  if (other) return false;
  if (!hasOpenSeat(await occupancyOf(unit, cohort.id))) return false;
  const { source, gone } = await transferSource(unit, enrollment);
  if (gone || !(await reacquirePromo(unit, enrollment.id))) return false;
  await unit.tx.waitlistEntry.updateMany({
    where: { cohortId: cohort.id, studentId: enrollment.studentId, status: 'waiting' },
    data: { status: 'left' },
  });
  await confirmPaid(unit, enrollment, source, 1);
  return true;
};

const settle = async (
  unit: Unit,
  enrollment: Enrollment,
  cohort: Cohort,
  payment: { readonly id: string; readonly amountMinor: number },
): Promise<PaymentOutcome> => {
  const { status } = enrollment;
  const payable = status === 'held' || status === 'offered' || status === 'expired';
  if (!payable) {
    await returnPayment(unit, enrollment, payment, 'duplicate_payment');
    return 'refunding_duplicate';
  }
  if (payment.amountMinor !== enrollment.priceMinor) {
    await returnPayment(unit, enrollment, payment, 'amount_mismatch');
    return 'refunding_amount';
  }
  if (status === 'expired') {
    if (await honourLate(unit, enrollment, cohort)) return 'enrolled_late';
    await returnPayment(unit, enrollment, payment, 'late_payment');
    return 'refunding_late';
  }
  const { source, gone } = await transferSource(unit, enrollment);
  if (gone) {
    await returnPayment(unit, enrollment, payment, 'late_payment');
    return 'refunding_late';
  }
  await confirmPaid(unit, enrollment, source);
  return 'enrolled';
};

/**
 * Records money received and decides what it buys. Money is never left without either a seat or
 * a refund request, and one provider payment is recorded once.
 */
export const recordPayment = async (unit: Unit, input: Received): Promise<PaymentOutcome> => {
  const found = await unit.tx.enrollment.findUnique({
    where: { id: input.enrollmentId },
    include: { cohort: true, transferFrom: true },
  });
  if (!found || found.cohort.schoolId !== input.schoolId) return 'rejected_enrollment';
  if (found.currency !== input.currency) return 'rejected_currency';
  const read = await openCohorts(unit, [
    found.cohortId,
    ...(found.transferFrom ? [found.transferFrom.cohortId] : []),
  ]);
  const enrollment = await lockEnrollment(unit.tx, found.id);
  const recorded = await unit.tx.moneyOperation.findUnique({
    where: { providerPaymentId: input.providerPaymentId },
  });
  if (recorded) return 'already_recorded';
  const payment = await unit.tx.moneyOperation.create({
    data: {
      enrollmentId: enrollment.id,
      kind: 'payment',
      amountMinor: input.amountMinor,
      currency: input.currency,
      providerPaymentId: input.providerPaymentId,
      createdAt: unit.now,
    },
  });
  return settle(unit, enrollment, await read(enrollment.cohortId), {
    id: payment.id,
    amountMinor: input.amountMinor,
  });
};

export type RefundOutcome = 'refunded' | 'already_recorded' | 'rejected_refund';

/**
 * Books a refund the gateway performed. Its response and its notification both end here, in
 * either order, and the refund is booked once.
 */
export const completeRefund = async (
  unit: Unit,
  input: { readonly refundRequestId: string; readonly schoolId?: string },
): Promise<RefundOutcome> => {
  const request = await unit.tx.refundRequest.findUnique({
    where: { id: input.refundRequestId },
    include: { enrollment: { include: { cohort: true } } },
  });
  if (!request) return 'rejected_refund';
  const { enrollment } = request;
  if (input.schoolId !== undefined && enrollment.cohort.schoolId !== input.schoolId) {
    return 'rejected_refund';
  }
  await unit.tx.$queryRaw`
    SELECT id FROM refund_requests WHERE id = ${request.id}::uuid FOR NO KEY UPDATE`;
  const current = await unit.tx.refundRequest.findUniqueOrThrow({ where: { id: request.id } });
  if (current.status === 'succeeded') return 'already_recorded';
  await unit.tx.moneyOperation.create({
    data: {
      enrollmentId: enrollment.id,
      kind: 'refund',
      amountMinor: current.amountMinor,
      currency: current.currency,
      refundRequestId: current.id,
      createdAt: unit.now,
    },
  });
  await unit.tx.refundRequest.update({
    where: { id: current.id },
    data: { status: 'succeeded', completedAt: unit.now },
  });
  await emailStudent(unit, enrollment.studentId, {
    dedupeKey: `refunded:${current.id}`,
    subject: 'Your refund was sent',
    body: `${(Number(current.amountMinor) / 100).toFixed(2)} ${current.currency} was returned to you.`,
  });
  return 'refunded';
};

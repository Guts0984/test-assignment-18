import { type Enrollment } from '@prisma/client';
import { type Unit } from './context';
import { emailStudent } from './outbox';
import { consumePromo } from './promo-use';
import { journalSeats, SYSTEM_ACTOR } from './seat-journal';
import { freeSeat } from './seats';

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

/** Closes the source of a transfer once the new seat is secured. Its cohort must be locked. */
export const closeTransferSource = async (
  unit: Unit,
  source: Enrollment,
  actor: Parameters<typeof freeSeat>[1]['actor'],
): Promise<void> => {
  await unit.tx.enrollment.update({
    where: { id: source.id },
    data: { status: 'transferred', updatedAt: unit.now },
  });
  await freeSeat(unit, {
    cohortId: source.cohortId,
    enrollmentId: source.id,
    reason: 'transfer_out',
    actor,
  });
};

/**
 * Turns a seated enrollment into a paid one. For a transfer surcharge this also moves the money
 * of the old enrollment and frees the old seat.
 */
export const confirmPaid = async (
  unit: Unit,
  enrollment: Enrollment,
  source: Enrollment | null,
  /** 1 when the payment also takes the seat again, after a hold had expired. */
  seatsDelta: 0 | 1 = 0,
): Promise<void> => {
  await unit.tx.enrollment.update({
    where: { id: enrollment.id },
    data: { status: 'paid', paidAt: unit.now, updatedAt: unit.now },
  });
  await journalSeats(unit.tx, {
    cohortId: enrollment.cohortId,
    enrollmentId: enrollment.id,
    seatsDelta,
    reason: 'payment',
    actor: SYSTEM_ACTOR,
    at: unit.now,
  });
  await consumePromo(unit, enrollment.id);
  await unit.tx.waitlistEntry.updateMany({
    where: { cohortId: enrollment.cohortId, studentId: enrollment.studentId, status: 'offered' },
    data: { status: 'converted' },
  });
  if (source) {
    await moveCredit(unit, {
      fromId: source.id,
      toId: enrollment.id,
      amountMinor: await spendableBalance(unit, source.id),
      currency: source.currency,
    });
    await closeTransferSource(unit, source, SYSTEM_ACTOR);
  }
  const cohort = await unit.tx.cohort.findUniqueOrThrow({
    where: { id: enrollment.cohortId },
    include: { course: true },
  });
  await emailStudent(unit, enrollment.studentId, {
    schoolId: cohort.schoolId,
    dedupeKey: `paid:${enrollment.id}`,
    subject: `You are enrolled: ${cohort.course.title}`,
    body: `Your place in "${cohort.course.title}" is confirmed. It starts on ${cohort.startDate.toISOString().slice(0, 10)}.`,
  });
  unit.touched.add(enrollment.cohortId);
};

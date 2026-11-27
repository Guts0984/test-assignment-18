import { type Enrollment } from '@prisma/client';
import { type Unit } from './context';
import { emailStudent } from './outbox';
import { consumePromo } from './promo-use';
import { journalSeats, SYSTEM_ACTOR } from './seat-journal';

/** Turns a seated enrollment into a paid one: status, journal, promo, waitlist and e-mail. */
export const markPaid = async (
  unit: Unit,
  enrollment: Enrollment,
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

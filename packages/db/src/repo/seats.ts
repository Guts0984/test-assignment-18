import { type Cohort } from '@prisma/client';
import { holdExpiryJob } from '@school/shared/jobs/job';
import { type Unit } from './context';
import { emailStudent } from './outbox';
import { releasePromo } from './promo-use';
import { journalSeats, SYSTEM_ACTOR } from './seat-journal';

export type Occupancy = { readonly free: number; readonly waiting: number };

export const occupancyOf = async (unit: Unit, cohortId: string): Promise<Occupancy> => {
  const cohort = await unit.tx.cohort.findUniqueOrThrow({ where: { id: cohortId } });
  const waiting = await unit.tx.waitlistEntry.count({ where: { cohortId, status: 'waiting' } });
  return { free: cohort.capacity - cohort.seatsTaken, waiting };
};

/** Whether someone who is not first in line may take a seat. */
export const hasOpenSeat = ({ free, waiting }: Occupancy): boolean => free > waiting;

const offerExpiry = (unit: Unit, cohort: Cohort): Date =>
  new Date(
    Math.min(unit.now.getTime() + unit.timings.offerTtlSec * 1000, cohort.startsAt.getTime()),
  );

const offerSeat = async (
  unit: Unit,
  cohort: Cohort,
  entry: { readonly id: string; readonly studentId: string },
): Promise<void> => {
  const holdExpiresAt = offerExpiry(unit, cohort);
  const enrollment = await unit.tx.enrollment.create({
    data: {
      cohortId: cohort.id,
      studentId: entry.studentId,
      status: 'offered',
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
    reason: 'offer',
    actor: SYSTEM_ACTOR,
    at: unit.now,
  });
  await unit.tx.waitlistEntry.update({
    where: { id: entry.id },
    data: { status: 'offered', offeredAt: unit.now, enrollmentId: enrollment.id },
  });
  const course = await unit.tx.course.findUniqueOrThrow({ where: { id: cohort.courseId } });
  await emailStudent(unit, entry.studentId, {
    dedupeKey: `offer:${enrollment.id}`,
    subject: `A seat is free: ${course.title}`,
    body:
      `A seat in "${course.title}" is yours until ${holdExpiresAt.toISOString()}.\n` +
      `Open your account and pay to enroll.`,
  });
  unit.jobs.push(holdExpiryJob(enrollment.id, holdExpiresAt));
};

/**
 * Hands every free seat to the longest-waiting students, one seat and one offer each. Runs in
 * the transaction that freed the seats, so nobody else can take them. The cohort must be locked.
 */
export const allocateFreedSeats = async (unit: Unit, cohortId: string): Promise<void> => {
  for (;;) {
    const cohort = await unit.tx.cohort.findUniqueOrThrow({ where: { id: cohortId } });
    if (cohort.capacity <= cohort.seatsTaken || cohort.startsAt <= unit.now) return;
    const next = await unit.tx.waitlistEntry.findFirst({
      where: { cohortId, status: 'waiting' },
      orderBy: { position: 'asc' },
    });
    if (!next) return;
    const active = await unit.tx.enrollment.findFirst({
      where: {
        cohortId,
        studentId: next.studentId,
        status: { in: ['held', 'offered', 'paid', 'completed'] },
      },
    });
    if (active) {
      // Already seated some other way: the place in line is no longer needed.
      await unit.tx.waitlistEntry.update({ where: { id: next.id }, data: { status: 'left' } });
    } else {
      await offerSeat(unit, cohort, next);
    }
  }
};

/** Journals a released seat and passes it on. The enrollment status is the caller's job. */
export const freeSeat = async (
  unit: Unit,
  input: Omit<Parameters<typeof journalSeats>[1], 'seatsDelta' | 'at'>,
): Promise<void> => {
  await journalSeats(unit.tx, { ...input, seatsDelta: -1, at: unit.now });
  unit.touched.add(input.cohortId);
  await allocateFreedSeats(unit, input.cohortId);
};

/** Ends one held or offered enrollment whose time ran out. The cohort must be locked. */
const expireOne = async (
  unit: Unit,
  enrollment: { readonly id: string; readonly cohortId: string },
): Promise<void> => {
  await unit.tx.enrollment.update({
    where: { id: enrollment.id },
    data: { status: 'expired', updatedAt: unit.now },
  });
  await releasePromo(unit, enrollment.id);
  await unit.tx.waitlistEntry.updateMany({
    where: { enrollmentId: enrollment.id, status: 'offered' },
    data: { status: 'offer_expired' },
  });
  await freeSeat(unit, {
    cohortId: enrollment.cohortId,
    enrollmentId: enrollment.id,
    reason: 'expiry',
    actor: SYSTEM_ACTOR,
  });
};

/**
 * Expires every overdue hold and offer of a locked cohort. Each writer calls it first, so
 * correctness never depends on how promptly the worker runs, and a seat comes back once.
 */
export const expireOverdue = async (unit: Unit, cohortId: string): Promise<number> => {
  const overdue = await unit.tx.enrollment.findMany({
    where: { cohortId, status: { in: ['held', 'offered'] }, holdExpiresAt: { lte: unit.now } },
    orderBy: [{ holdExpiresAt: 'asc' }, { id: 'asc' }],
    select: { id: true, cohortId: true },
  });
  for (const enrollment of overdue) await expireOne(unit, enrollment);
  return overdue.length;
};

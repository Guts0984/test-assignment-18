import { type Unit } from './context';
import { cancelEnrollment } from './cancel';
import { openCohorts } from './open-cohorts';
import { hasOpenSeat, occupancyOf } from './seats';

export type JoinRejection =
  'NOT_FOUND' | 'ENROLLMENT_CLOSED' | 'ALREADY_ENROLLED' | 'SEATS_AVAILABLE';

/** Joins the queue of a full cohort. Joining again keeps the original place. */
export const joinWaitlist = async (
  unit: Unit,
  input: { readonly cohortId: string; readonly studentId: string },
): Promise<'JOINED' | JoinRejection> => {
  const exists = await unit.tx.cohort.findUnique({ where: { id: input.cohortId } });
  if (!exists) return 'NOT_FOUND';
  const read = await openCohorts(unit, [input.cohortId]);
  const cohort = await read(input.cohortId);
  const entry = await unit.tx.waitlistEntry.findFirst({
    where: { ...input, status: { in: ['waiting', 'offered'] } },
  });
  if (entry) return 'JOINED';
  const active = await unit.tx.enrollment.findFirst({
    where: { ...input, status: { in: ['held', 'offered', 'paid', 'completed'] } },
  });
  if (active) return 'ALREADY_ENROLLED';
  if (cohort.startsAt <= unit.now) return 'ENROLLMENT_CLOSED';
  if (hasOpenSeat(await occupancyOf(unit, cohort.id))) return 'SEATS_AVAILABLE';
  await unit.tx.waitlistEntry.create({
    data: { ...input, status: 'waiting', joinedAt: unit.now },
  });
  unit.touched.add(cohort.id);
  return 'JOINED';
};

/** Leaves the queue; an open offer is declined, which passes the seat on. */
export const leaveWaitlist = async (
  unit: Unit,
  input: { readonly cohortId: string; readonly studentId: string },
): Promise<'LEFT' | 'NOT_FOUND'> => {
  const exists = await unit.tx.cohort.findUnique({ where: { id: input.cohortId } });
  if (!exists) return 'NOT_FOUND';
  await openCohorts(unit, [input.cohortId]);
  const entry = await unit.tx.waitlistEntry.findFirst({
    where: { ...input, status: { in: ['waiting', 'offered'] } },
  });
  if (!entry) return 'NOT_FOUND';
  if (entry.status === 'offered' && entry.enrollmentId) {
    await cancelEnrollment(unit, {
      enrollmentId: entry.enrollmentId,
      actor: { kind: 'student', id: input.studentId },
      policy: 'rule',
    });
  } else {
    await unit.tx.waitlistEntry.update({ where: { id: entry.id }, data: { status: 'left' } });
    unit.touched.add(input.cohortId);
  }
  return 'LEFT';
};

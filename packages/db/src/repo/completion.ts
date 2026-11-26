import { certificateJob } from '@school/shared/jobs/job';
import { type Unit } from './context';
import { lockCohorts } from './locks';
import { expireOverdue } from './seats';

/**
 * Closes a cohort whose last lesson is over: paid enrollments complete and become due for a
 * certificate, and nobody waits any longer. Running it again changes nothing.
 */
export const completeCohort = async (unit: Unit, cohortId: string): Promise<number> => {
  const cohort = (await lockCohorts(unit.tx, [cohortId])).get(cohortId);
  if (!cohort?.endsAt || cohort.endsAt > unit.now || cohort.completedAt) return 0;
  await expireOverdue(unit, cohortId);
  await unit.tx.waitlistEntry.updateMany({
    where: { cohortId, status: 'waiting' },
    data: { status: 'left' },
  });
  const completed = await unit.tx.enrollment.updateManyAndReturn({
    where: { cohortId, status: 'paid' },
    data: { status: 'completed', certificateDueAt: unit.now, updatedAt: unit.now },
    select: { id: true },
  });
  await unit.tx.cohort.update({ where: { id: cohortId }, data: { completedAt: unit.now } });
  unit.jobs.push(...completed.map((row) => certificateJob(row.id)));
  unit.touched.add(cohortId);
  return completed.length;
};

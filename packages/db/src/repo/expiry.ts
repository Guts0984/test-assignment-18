import { type Unit } from './context';
import { lockCohorts } from './locks';
import { expireOverdue } from './seats';

/**
 * The expiry job: ends the enrollment if its time is up. Running it again, early, or after a
 * payment changes nothing.
 */
export const expireEnrollment = async (unit: Unit, enrollmentId: string): Promise<void> => {
  const enrollment = await unit.tx.enrollment.findUnique({ where: { id: enrollmentId } });
  if (!enrollment) return;
  await lockCohorts(unit.tx, [enrollment.cohortId]);
  await expireOverdue(unit, enrollment.cohortId);
};

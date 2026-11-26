import { type Cohort } from '@prisma/client';
import { type Unit } from './context';
import { cohortOf, lockCohorts } from './locks';
import { allocateFreedSeats, expireOverdue } from './seats';

/** Locks cohorts and brings each up to date: overdue holds expired, free seats offered. */
export const openCohorts = async (
  unit: Unit,
  ids: readonly string[],
): Promise<(id: string) => Promise<Cohort>> => {
  const locked = await lockCohorts(unit.tx, ids);
  for (const id of locked.keys()) {
    await expireOverdue(unit, id);
    await allocateFreedSeats(unit, id);
  }
  return async (id) => {
    cohortOf(locked, id);
    return unit.tx.cohort.findUniqueOrThrow({ where: { id } });
  };
};

import { type Unit } from './context';
import { openCohorts } from './open-cohorts';
import { journalCapacity, type ActorRef } from './seat-journal';
import { allocateFreedSeats } from './seats';

/** Raises or lowers the number of seats, never below those taken. New seats go to waiters. */
export const changeCapacity = async (
  unit: Unit,
  input: {
    readonly cohortId: string;
    readonly capacity: number;
    readonly actor: ActorRef;
  },
): Promise<'CHANGED' | 'CAPACITY_BELOW_TAKEN'> => {
  const read = await openCohorts(unit, [input.cohortId]);
  const cohort = await read(input.cohortId);
  if (input.capacity < cohort.seatsTaken) return 'CAPACITY_BELOW_TAKEN';
  const capacityDelta = input.capacity - cohort.capacity;
  if (capacityDelta !== 0) {
    await journalCapacity(unit.tx, {
      cohortId: cohort.id,
      capacityDelta,
      actor: input.actor,
      at: unit.now,
    });
    unit.touched.add(cohort.id);
    await allocateFreedSeats(unit, cohort.id);
  }
  return 'CHANGED';
};

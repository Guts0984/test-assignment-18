import { systemClock, type Clock } from '@school/shared/clock/clock';
import { type Db } from './client';

/** Business time. SQL receives it as a parameter and never asks the database for `now()`. */
export type TimeSource = {
  readonly now: () => Promise<Date>;
};

export const fromClock = (clock: Clock): TimeSource => ({
  now: () => Promise.resolve(clock.now()),
});

export const systemTime: TimeSource = fromClock(systemClock);

const readOffsetMs = async (db: Db): Promise<number> => {
  const row = await db.testClock.findUnique({ where: { id: 1 } });
  return Number(row?.offsetMs ?? 0n);
};

/** A clock every process shares through Postgres. Only used when the test clock is enabled. */
export const createSharedTestTime = (db: Db, base: Clock = systemClock): TimeSource => ({
  now: async () => new Date(base.now().getTime() + (await readOffsetMs(db))),
});

export const setSharedTestTime = async (
  db: Db,
  target: Date,
  base: Clock = systemClock,
): Promise<void> => {
  const offsetMs = BigInt(target.getTime() - base.now().getTime());
  await db.testClock.upsert({
    where: { id: 1 },
    create: { id: 1, offsetMs },
    update: { offsetMs },
  });
};

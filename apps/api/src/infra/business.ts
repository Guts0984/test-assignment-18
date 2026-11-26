import { type Unit } from '@school/db/repo/context';
import { runUnit } from '@school/db/repo/unit-of-work';
import { type Deps } from './deps';

/** Runs one business transaction at the current time, then publishes what it asked for. */
export const runBusiness = async <T>(deps: Deps, work: (unit: Unit) => Promise<T>): Promise<T> => {
  const { env, db, time, jobs } = deps;
  const committed = await runUnit(
    db,
    {
      now: await time.now(),
      timings: { holdTtlSec: env.HOLD_TTL_SEC, offerTtlSec: env.OFFER_TTL_SEC },
    },
    work,
  );
  await jobs.publish(committed.jobs);
  return committed.value;
};

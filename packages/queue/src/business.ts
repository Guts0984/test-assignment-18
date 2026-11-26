import { type Db } from '@school/db/client';
import { type Timings, type Unit } from '@school/db/repo/context';
import { runUnit } from '@school/db/repo/unit-of-work';
import { type TimeSource } from '@school/db/time';
import { type Publisher } from './publisher';
import { type Realtime } from './realtime';

export type BusinessDeps = {
  readonly db: Db;
  readonly time: TimeSource;
  readonly timings: Timings;
  readonly jobs: Publisher;
  readonly realtime: Realtime;
};

/**
 * Runs one business transaction at the current time. Only after it commits are its jobs
 * published and live updates sent.
 */
export const runBusiness = async <T>(
  deps: BusinessDeps,
  work: (unit: Unit) => Promise<T>,
): Promise<T> => {
  const now = await deps.time.now();
  const committed = await runUnit(deps.db, { now, timings: deps.timings }, work);
  await deps.jobs.publish(committed.jobs, now);
  await deps.realtime.cohortsChanged(deps.db, committed.touched);
  return committed.value;
};

import { type Job } from '@school/shared/jobs/job';
import { type Tx } from '../client';

export type Timings = {
  readonly holdTtlSec: number;
  readonly offerTtlSec: number;
};

/**
 * One business transaction: the connection, the moment it happens at, and the jobs to publish
 * after it commits.
 */
export type Unit = {
  readonly tx: Tx;
  readonly now: Date;
  readonly timings: Timings;
  readonly jobs: Job[];
  /** Cohorts whose occupancy changed, for live updates. */
  readonly touched: Set<string>;
};

export const createUnit = (tx: Tx, now: Date, timings: Timings): Unit => ({
  tx,
  now,
  timings,
  jobs: [],
  touched: new Set(),
});

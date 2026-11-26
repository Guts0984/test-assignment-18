import { type Job } from '@school/shared/jobs/job';
import { type Db } from '../client';
import { inTransaction } from '../transaction';
import { createUnit, type Timings, type Unit } from './context';

export type Committed<T> = {
  readonly value: T;
  readonly jobs: readonly Job[];
  readonly touched: readonly string[];
};

/** Runs a business transaction and returns its effects only if it committed. */
export const runUnit = <T>(
  db: Db,
  input: { readonly now: Date; readonly timings: Timings },
  work: (unit: Unit) => Promise<T>,
): Promise<Committed<T>> =>
  inTransaction(db, async (tx) => {
    const unit = createUnit(tx, input.now, input.timings);
    const value = await work(unit);
    return { value, jobs: unit.jobs, touched: [...unit.touched] };
  });

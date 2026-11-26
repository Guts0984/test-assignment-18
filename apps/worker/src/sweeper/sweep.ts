import { completeCohort } from '@school/db/repo/completion';
import { cohortsToComplete, findDueJobs } from '@school/db/repo/due-work';
import { runBusiness } from '@school/queue/business';
import { type WorkerDeps } from '../deps';

/**
 * One pass of recovery: closes finished cohorts and queues everything Postgres says is due.
 * Running on several workers at once is harmless, because job ids are the same and every
 * effect is guarded in the database.
 */
export const sweep = async (deps: WorkerDeps): Promise<number> => {
  const timings = {
    holdTtlSec: deps.env.HOLD_TTL_SEC,
    offerTtlSec: deps.env.OFFER_TTL_SEC,
  };
  for (const cohortId of await cohortsToComplete(deps.db, await deps.time.now())) {
    await runBusiness({ ...deps, timings }, (unit) => completeCohort(unit, cohortId));
  }
  const due = await findDueJobs(deps.db, await deps.time.now(), new Date());
  await deps.jobs.recover(due);
  return due.length;
};

import { recordFailure, resolveFailures } from '@school/db/repo/job-failures';
import { QUEUES, type JobPayload, type QueueName } from '@school/shared/jobs/registry';
import { recordOf } from '@school/shared/jobs/retry';
import { type WorkerDeps } from '../deps';
import { HANDLERS } from './handlers';

export type Attempt = {
  readonly data: unknown;
  /** Attempts that already failed. */
  readonly attemptsMade: number;
  readonly attempts: number;
};

/**
 * Runs one attempt. When the last one fails, the failure is written to Postgres before BullMQ
 * hears of it, so a manager sees it even if Redis is lost.
 */
// The type parameter ties a queue to its own payload and handler.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export const runJob = async <Q extends QueueName>(
  deps: WorkerDeps,
  queue: Q,
  attempt: Attempt,
): Promise<void> => {
  const payload = QUEUES[queue].payload.parse(attempt.data) as JobPayload<Q>;
  const key = recordOf(queue, payload);
  try {
    await HANDLERS[queue](deps, payload);
  } catch (error) {
    const made = attempt.attemptsMade + 1;
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.warn({ queue, record: key, attempt: made, error: message }, 'job failed');
    if (made >= attempt.attempts) {
      await recordFailure(deps.db, {
        queue,
        key,
        payload,
        error: message,
        attempts: made,
        at: await deps.time.now(),
      });
    }
    throw error;
  }
  if (attempt.attemptsMade > 0) {
    await resolveFailures(deps.db, queue, key, await deps.time.now());
  }
};

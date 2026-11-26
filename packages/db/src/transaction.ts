import { type Db, type Tx } from './client';
import { isTransientConflict } from './errors';

/** Long enough for a burst of hundreds of requests to queue on one row lock. */
const WAIT_MS = 30_000;
const ATTEMPTS = 5;

/**
 * Runs `work` in a READ COMMITTED transaction; correctness comes from explicit row locks and
 * constraints. A deadlock or serialization failure repeats the whole transaction.
 */
export const inTransaction = async <T>(db: Db, work: (tx: Tx) => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.$transaction(work, { maxWait: WAIT_MS, timeout: WAIT_MS });
    } catch (error) {
      if (attempt >= ATTEMPTS || !isTransientConflict(error)) throw error;
    }
  }
};

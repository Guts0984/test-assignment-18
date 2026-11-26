import { randomUUID } from 'node:crypto';
import { sign, SIGNATURE_HEADER } from '@school/gateway/signature';
import { type Notification } from '@school/shared/schemas/gateway-protocol';
import { type Pool } from 'pg';
import { retryDelayMs } from './chaos';

type Fields<T> = T extends unknown ? Omit<T, 'eventId' | 'occurredAt'> : never;
export type Event = Fields<Notification>;

export type DeliverySettings = {
  readonly key: string;
  readonly maxAttempts: number;
  readonly retryBaseMs: number;
};

export const enqueueDelivery = async (
  pool: Pool,
  event: Event,
  targets: readonly string[],
  delaySec = 0,
): Promise<void> => {
  const eventId = randomUUID();
  const body = JSON.stringify({ ...event, eventId, occurredAt: new Date().toISOString() });
  await pool.query(
    `INSERT INTO deliveries (event_id, targets, body, school_id, next_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
    [eventId, targets, body, event.schoolId, delaySec],
  );
};

/** Signed at send time, so a notification delayed for long still carries a fresh timestamp. */
const send = async (target: string, body: string, key: string): Promise<void> => {
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [SIGNATURE_HEADER]: sign(key, body, new Date()),
    },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
};

type Due = { id: string; targets: string[]; body: string; attempts: number };

/**
 * Sends every due notification to all its targets at once, retrying failures with backoff.
 * Rows are claimed with `SKIP LOCKED`, so overlapping runs never send a row twice.
 */
export const deliverDue = async (pool: Pool, settings: DeliverySettings): Promise<number> => {
  const claimed = await pool.query<Due>(
    `UPDATE deliveries SET attempts = attempts + 1,
            next_at = now() + interval '30 seconds'
      WHERE id IN (SELECT id FROM deliveries
                    WHERE delivered_at IS NULL AND next_at <= now() AND attempts < $1
                    ORDER BY next_at LIMIT 100 FOR UPDATE SKIP LOCKED)
      RETURNING id, targets, body, attempts`,
    [settings.maxAttempts],
  );
  await Promise.all(
    claimed.rows.map(async (row) => {
      const results = await Promise.allSettled(
        row.targets.map((target) => send(target, row.body, settings.key)),
      );
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) {
        await pool.query(
          `UPDATE deliveries SET last_error = $2,
                  next_at = now() + make_interval(secs => $3) WHERE id = $1`,
          [row.id, String(failed.reason), retryDelayMs(settings.retryBaseMs, row.attempts) / 1000],
        );
      } else {
        await pool.query('UPDATE deliveries SET delivered_at = now() WHERE id = $1', [row.id]);
      }
    }),
  );
  return claimed.rows.length;
};

/** Makes delayed notifications due now. Used by tests instead of waiting twenty minutes. */
export const releaseDelayed = async (pool: Pool): Promise<number> => {
  const result = await pool.query(
    'UPDATE deliveries SET next_at = now() WHERE delivered_at IS NULL',
  );
  return result.rowCount ?? 0;
};

import { randomUUID } from 'node:crypto';
import {
  type CreateSessionInput,
  type GatewayRefundInput,
} from '@school/shared/schemas/gateway-protocol';
import { type Pool } from 'pg';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  order_id uuid NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  description text NOT NULL,
  return_url text NOT NULL,
  callback_url text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  payment_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, amount_minor)
);
CREATE TABLE IF NOT EXISTS refunds (
  refund_id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  order_id uuid NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  callback_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS refund_calls (
  id bigserial PRIMARY KEY,
  refund_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS deliveries (
  id bigserial PRIMARY KEY,
  event_id text NOT NULL,
  targets text[] NOT NULL,
  body text NOT NULL,
  school_id uuid NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  next_at timestamptz NOT NULL,
  delivered_at timestamptz,
  last_error text
);
CREATE INDEX IF NOT EXISTS deliveries_due_idx ON deliveries (next_at) WHERE delivered_at IS NULL;
`;

export type SessionRow = {
  readonly id: string;
  readonly school_id: string;
  readonly order_id: string;
  readonly amount_minor: string;
  readonly currency: string;
  readonly description: string;
  readonly return_url: string;
  readonly callback_url: string;
  readonly status: 'open' | 'paid' | 'declined' | 'closed';
  readonly payment_id: string | null;
};

export const migrate = async (pool: Pool): Promise<void> => {
  await pool.query(SCHEMA);
};

/** One session per order and amount, so repeating the request returns the same page. */
export const upsertSession = async (pool: Pool, input: CreateSessionInput): Promise<string> => {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO sessions (id, school_id, order_id, amount_minor, currency, description,
                           return_url, callback_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (order_id, amount_minor)
       DO UPDATE SET return_url = EXCLUDED.return_url, callback_url = EXCLUDED.callback_url
     RETURNING id`,
    [
      randomUUID(),
      input.schoolId,
      input.orderId,
      input.amountMinor,
      input.currency,
      input.description,
      input.returnUrl,
      input.callbackUrl,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('The session was not stored');
  return id;
};

export const findSession = async (pool: Pool, id: string): Promise<SessionRow | undefined> => {
  const result = await pool.query<SessionRow>('SELECT * FROM sessions WHERE id = $1', [id]);
  return result.rows[0];
};

/** Takes the money once: only the first click on an unpaid session succeeds. */
export const markPaid = async (pool: Pool, id: string): Promise<SessionRow | undefined> => {
  const result = await pool.query<SessionRow>(
    `UPDATE sessions SET status = 'paid', payment_id = $2
      WHERE id = $1 AND status <> 'paid' RETURNING *`,
    [id, randomUUID()],
  );
  return result.rows[0];
};

export const markStatus = async (
  pool: Pool,
  id: string,
  status: 'declined' | 'closed',
): Promise<void> => {
  await pool.query(`UPDATE sessions SET status = $2 WHERE id = $1 AND status <> 'paid'`, [
    id,
    status,
  ]);
};

export const countRefundCall = async (pool: Pool, refundId: string): Promise<number> => {
  const result = await pool.query<{ id: string }>(
    'INSERT INTO refund_calls (refund_id) VALUES ($1) RETURNING id',
    [refundId],
  );
  return Number(result.rows[0]?.id ?? 0);
};

export type RefundStored = 'created' | 'repeated' | 'conflict';

/** Performs a refund once per id; the same id with other content is refused. */
export const storeRefund = async (pool: Pool, input: GatewayRefundInput): Promise<RefundStored> => {
  const inserted = await pool.query(
    `INSERT INTO refunds (refund_id, school_id, order_id, amount_minor, currency, callback_url)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (refund_id) DO NOTHING`,
    [
      input.refundId,
      input.schoolId,
      input.orderId,
      input.amountMinor,
      input.currency,
      input.callbackUrl,
    ],
  );
  if (inserted.rowCount === 1) return 'created';
  const same = await pool.query(
    `SELECT 1 FROM refunds WHERE refund_id = $1 AND school_id = $2 AND order_id = $3
        AND amount_minor = $4 AND currency = $5`,
    [input.refundId, input.schoolId, input.orderId, input.amountMinor, input.currency],
  );
  return same.rowCount === 1 ? 'repeated' : 'conflict';
};

export const listTransactions = async (pool: Pool, limit = 500) => {
  const payments = await pool.query<SessionRow>(
    'SELECT * FROM sessions ORDER BY created_at DESC LIMIT $1',
    [limit],
  );
  const refunds = await pool.query<{
    refund_id: string;
    order_id: string;
    amount_minor: string;
    currency: string;
  }>('SELECT * FROM refunds ORDER BY created_at DESC LIMIT $1', [limit]);
  return { payments: payments.rows, refunds: refunds.rows };
};

import { type Db } from '../client';

const LEASE_MS = 60_000;

export type OutgoingEmail = {
  readonly id: string;
  readonly dedupeKey: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
};

type Claimed = {
  id: string;
  dedupe_key: string;
  to_address: string;
  subject: string;
  body: string;
};

/**
 * Sends one outbox email. A lease stops two workers sending it at once; a worker that dies
 * holding it frees it when the lease runs out. Returns `busy` while someone else holds it.
 */
export const deliverEmail = async (
  db: Db,
  input: { readonly emailId: string; readonly now: () => Date; readonly leaseMs?: number },
  send: (email: OutgoingEmail) => Promise<void>,
): Promise<'sent' | 'already_sent' | 'busy' | 'missing'> => {
  const now = input.now();
  const leaseUntil = new Date(now.getTime() + (input.leaseMs ?? LEASE_MS));
  const [row] = await db.$queryRaw<Claimed[]>`
    UPDATE email_outbox SET status = 'sending', lease_until = ${leaseUntil},
           attempts = attempts + 1
     WHERE id = ${input.emailId}::uuid
       AND (status = 'pending' OR (status = 'sending' AND lease_until < ${now}))
     RETURNING id, dedupe_key, to_address, subject, body`;
  if (!row) {
    const current = await db.emailOutbox.findUnique({ where: { id: input.emailId } });
    if (!current) return 'missing';
    return current.status === 'sent' ? 'already_sent' : 'busy';
  }
  try {
    await send({
      id: row.id,
      dedupeKey: row.dedupe_key,
      to: row.to_address,
      subject: row.subject,
      body: row.body,
    });
  } catch (error) {
    await db.emailOutbox.update({
      where: { id: row.id },
      data: { status: 'pending', leaseUntil: null },
    });
    throw error;
  }
  await db.emailOutbox.update({
    where: { id: row.id },
    data: { status: 'sent', sentAt: input.now(), leaseUntil: null },
  });
  return 'sent';
};

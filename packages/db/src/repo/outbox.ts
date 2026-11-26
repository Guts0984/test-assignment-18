import { randomUUID } from 'node:crypto';
import { emailJob } from '@school/shared/jobs/job';
import { type Unit } from './context';

export type Email = {
  /** The same key is never sent twice. */
  readonly dedupeKey: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
};

/** Writes an email in the current transaction. It is sent after the commit, once. */
export const queueEmail = async (unit: Unit, email: Email): Promise<void> => {
  const id = randomUUID();
  const created = await unit.tx.emailOutbox.createMany({
    data: [
      {
        id,
        dedupeKey: email.dedupeKey,
        toAddress: email.to,
        subject: email.subject,
        body: email.body,
        createdAt: unit.now,
      },
    ],
    skipDuplicates: true,
  });
  if (created.count === 1) unit.jobs.push(emailJob(id));
};

export const emailStudent = async (
  unit: Unit,
  studentId: string,
  email: Omit<Email, 'to'>,
): Promise<void> => {
  const student = await unit.tx.user.findUniqueOrThrow({ where: { id: studentId } });
  await queueEmail(unit, {
    ...email,
    to: student.email,
    body: `Hello ${student.fullName},\n\n${email.body}\n`,
  });
};

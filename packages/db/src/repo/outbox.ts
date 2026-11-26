import { emailJob } from '@school/shared/jobs/job';
import { type Unit } from './context';

export type Email = {
  readonly schoolId: string;
  /** The same key is never sent twice. */
  readonly dedupeKey: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
};

/** Writes emails in the current transaction. They are sent after the commit, once each. */
export const queueEmails = async (unit: Unit, emails: readonly Email[]): Promise<void> => {
  if (emails.length === 0) return;
  const created = await unit.tx.emailOutbox.createManyAndReturn({
    data: emails.map((email) => ({
      schoolId: email.schoolId,
      dedupeKey: email.dedupeKey,
      toAddress: email.to,
      subject: email.subject,
      body: email.body,
      createdAt: unit.now,
    })),
    select: { id: true },
    skipDuplicates: true,
  });
  unit.jobs.push(...created.map((row) => emailJob(row.id)));
};

export const emailStudent = async (
  unit: Unit,
  studentId: string,
  email: Omit<Email, 'to'>,
): Promise<void> => {
  const student = await unit.tx.user.findUniqueOrThrow({ where: { id: studentId } });
  await queueEmails(unit, [
    { ...email, to: student.email, body: `Hello ${student.fullName},\n\n${email.body}\n` },
  ]);
};

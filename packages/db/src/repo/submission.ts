import { isLate } from '@school/shared/homework/deadline';
import { canTransitionSubmission, type SubmissionStatus } from '@school/shared/status/submission';
import { type Unit } from './context';

export type Upload = {
  readonly fileName: string;
  readonly mimeType: string;
  readonly content: Buffer;
};

export type SubmitOutcome =
  { readonly submissionId: string; readonly mentorId: string } | 'NOT_FOUND' | 'SUBMISSION_LOCKED';

/**
 * Hands in homework, or replaces what was handed in. Work in review or already accepted cannot
 * be changed. Lateness is decided by the server at every hand-in.
 */
export const submitHomework = async (
  unit: Unit,
  input: {
    readonly homeworkId: string;
    readonly studentId: string;
    readonly body: string;
    readonly file: Upload | null;
  },
): Promise<SubmitOutcome> => {
  const homework = await unit.tx.homework.findUnique({ where: { id: input.homeworkId } });
  if (!homework) return 'NOT_FOUND';
  const [owned] = await unit.tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM enrollments
     WHERE student_id = ${input.studentId}::uuid AND cohort_id = ${homework.cohortId}::uuid
       AND status IN ('paid', 'completed')
       FOR NO KEY UPDATE`;
  if (!owned) return 'NOT_FOUND';
  const identity = { homeworkId: homework.id, enrollmentId: owned.id };
  await unit.tx.$queryRaw`
    SELECT id FROM submissions
     WHERE homework_id = ${homework.id}::uuid AND enrollment_id = ${owned.id}::uuid FOR UPDATE`;
  const current = await unit.tx.submission.findUnique({
    where: { homeworkId_enrollmentId: identity },
  });
  const from = (current?.status ?? null) as SubmissionStatus | null;
  if (!canTransitionSubmission(from, 'submitted', 'student')) return 'SUBMISSION_LOCKED';
  const data = {
    status: 'submitted',
    body: input.body,
    submittedAt: unit.now,
    isLate: isLate(unit.now, homework.deadlineAt),
  };
  const submission = await unit.tx.submission.upsert({
    where: { homeworkId_enrollmentId: identity },
    create: {
      ...identity,
      ...data,
      studentId: input.studentId,
      cohortId: homework.cohortId,
    },
    update: { ...data, version: { increment: 1 } },
  });
  await unit.tx.submissionFile.deleteMany({ where: { submissionId: submission.id } });
  if (input.file) {
    await unit.tx.submissionFile.create({
      data: {
        submissionId: submission.id,
        fileName: input.file.fileName,
        mimeType: input.file.mimeType,
        sizeBytes: input.file.content.length,
        content: new Uint8Array(input.file.content),
      },
    });
  }
  const cohort = await unit.tx.cohort.findUniqueOrThrow({ where: { id: homework.cohortId } });
  return { submissionId: submission.id, mentorId: cohort.mentorId };
};

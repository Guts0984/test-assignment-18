import { certificateJob } from '@school/shared/jobs/job';
import { type Unit } from './context';
import { emailStudent } from './outbox';

export type ClaimOutcome =
  { readonly submissionId: string } | 'REVIEW_LIMIT_REACHED' | 'NOTHING_TO_REVIEW';

/**
 * Takes the oldest waiting work of the mentor's cohorts, or a chosen one. The lock on the
 * mentor keeps the limit under concurrency; `SKIP LOCKED` keeps two reviewers off one work.
 */
export const claimSubmission = async (
  unit: Unit,
  input: {
    readonly mentorId: string;
    readonly submissionId: string | null;
    readonly limit: number;
  },
): Promise<ClaimOutcome> => {
  await unit.tx.$queryRaw`SELECT id FROM users WHERE id = ${input.mentorId}::uuid FOR UPDATE`;
  const inReview = await unit.tx.submission.count({
    where: { reviewerId: input.mentorId, status: 'in_review' },
  });
  if (inReview >= input.limit) return 'REVIEW_LIMIT_REACHED';
  const [next] = await unit.tx.$queryRaw<{ id: string }[]>`
    SELECT s.id FROM submissions s JOIN cohorts c ON c.id = s.cohort_id
     WHERE c.mentor_id = ${input.mentorId}::uuid AND s.status = 'submitted'
       AND (${input.submissionId}::uuid IS NULL OR s.id = ${input.submissionId}::uuid)
     ORDER BY s.submitted_at, s.id
     LIMIT 1 FOR UPDATE OF s SKIP LOCKED`;
  if (!next) return 'NOTHING_TO_REVIEW';
  await unit.tx.submission.update({
    where: { id: next.id },
    data: { status: 'in_review', reviewerId: input.mentorId, claimedAt: unit.now },
  });
  return { submissionId: next.id };
};

/** The work a mentor holds, locked; undefined if it is not theirs to decide. */
const lockOwnReview = async (unit: Unit, mentorId: string, submissionId: string) => {
  await unit.tx.$queryRaw`
    SELECT id FROM submissions WHERE id = ${submissionId}::uuid FOR UPDATE`;
  const submission = await unit.tx.submission.findFirst({
    where: { id: submissionId, reviewerId: mentorId, status: 'in_review' },
    include: { enrollment: { include: { cohort: { include: { course: true } } } } },
  });
  return submission ?? undefined;
};

export const releaseSubmission = async (
  unit: Unit,
  input: { readonly mentorId: string; readonly submissionId: string },
): Promise<'RELEASED' | 'NOT_FOUND'> => {
  const submission = await lockOwnReview(unit, input.mentorId, input.submissionId);
  if (!submission) return 'NOT_FOUND';
  await unit.tx.submission.update({
    where: { id: submission.id },
    data: { status: 'submitted', reviewerId: null, claimedAt: null },
  });
  return 'RELEASED';
};

export const reviewSubmission = async (
  unit: Unit,
  input: {
    readonly mentorId: string;
    readonly submissionId: string;
    readonly verdict: 'accepted' | 'returned';
    readonly comment: string;
    readonly score: number | null;
  },
): Promise<'REVIEWED' | 'NOT_FOUND'> => {
  const submission = await lockOwnReview(unit, input.mentorId, input.submissionId);
  if (!submission) return 'NOT_FOUND';
  await unit.tx.submission.update({
    where: { id: submission.id },
    data: { status: input.verdict, reviewerId: null, claimedAt: null },
  });
  const { submissionId, ...review } = input;
  const stored = await unit.tx.submissionReview.create({
    data: { ...review, submissionId, reviewedAt: unit.now },
  });
  const { enrollment } = submission;
  // Accepting work after the cohort ended may complete the certificate condition.
  if (input.verdict === 'accepted' && enrollment.status === 'completed') {
    await unit.tx.enrollment.update({
      where: { id: enrollment.id },
      data: { certificateDueAt: unit.now },
    });
    unit.jobs.push(certificateJob(enrollment.id));
  }
  await emailStudent(unit, submission.studentId, {
    schoolId: enrollment.cohort.schoolId,
    dedupeKey: `review:${stored.id}`,
    subject:
      input.verdict === 'accepted'
        ? `Homework accepted: ${enrollment.cohort.course.title}`
        : `Homework returned: ${enrollment.cohort.course.title}`,
    body: input.comment === '' ? 'See your account for details.' : input.comment,
  });
  return 'REVIEWED';
};

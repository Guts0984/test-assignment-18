import { type Prisma } from '@school/db/client';
import { type SubmissionView } from '@school/shared/schemas/homework';
import { type SubmissionStatus } from '@school/shared/status/submission';

/** The file's bytes are never loaded for a view. */
export const SUBMISSION_INCLUDE = {
  file: { select: { fileName: true, sizeBytes: true } },
  reviews: { orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }] },
} satisfies Prisma.SubmissionInclude;

type Row = Prisma.SubmissionGetPayload<{ include: typeof SUBMISSION_INCLUDE }>;

export const toSubmissionView = (row: Row): SubmissionView => ({
  id: row.id,
  homeworkId: row.homeworkId,
  status: row.status as SubmissionStatus,
  body: row.body,
  submittedAt: row.submittedAt.toISOString(),
  isLate: row.isLate,
  file: row.file ? { name: row.file.fileName, sizeBytes: row.file.sizeBytes } : null,
  reviews: row.reviews.map((review) => ({
    verdict: review.verdict as 'accepted' | 'returned',
    comment: review.comment,
    score: review.score,
    reviewedAt: review.reviewedAt.toISOString(),
  })),
});

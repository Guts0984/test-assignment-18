'use client';

import { useRouter } from 'next/navigation';
import { RequireRole, useSession } from '@/entities/session';
import { ReviewForm } from '@/features/review-submission';
import { useMentorSubmission } from '@/shared/api';
import { browserTimeZone, formatShort, useRouteParam } from '@/shared/lib';
import { Badge, Card, Page, QueryState } from '@/shared/ui';

const Detail = () => {
  const id = useRouteParam('id');
  const submission = useMentorSubmission(id);
  const router = useRouter();
  const { account } = useSession();
  const zone = account?.timeZone ?? browserTimeZone();
  return (
    <Page title="Homework">
      <QueryState query={submission}>
        {(data) => (
          <>
            <Card label="Work">
              <h2 className="font-semibold">
                {data.studentName} · {data.courseTitle} · {data.homeworkTitle}
              </h2>
              <p>
                Handed in {formatShort(data.submittedAt, zone)}, due{' '}
                {formatShort(data.deadlineAt, zone)} {data.isLate ? <Badge>Late</Badge> : null}
              </p>
              <p className="whitespace-pre-wrap">{data.body}</p>
              {data.file ? (
                <a className="underline" href={`/api/submissions/${data.id}/file`}>
                  Download {data.file.name}
                </a>
              ) : null}
              {data.reviews.map((review) => (
                <blockquote key={review.reviewedAt} className="border-l-4 pl-2">
                  {review.verdict}: {review.comment}
                </blockquote>
              ))}
            </Card>
            {data.status === 'in_review' ? (
              <Card label="Verdict">
                <ReviewForm
                  submissionId={data.id}
                  onDone={() => {
                    router.push('/mentor');
                  }}
                />
              </Card>
            ) : null}
          </>
        )}
      </QueryState>
    </Page>
  );
};

export const MentorSubmissionPage = () => (
  <RequireRole role="mentor">
    <Detail />
  </RequireRole>
);

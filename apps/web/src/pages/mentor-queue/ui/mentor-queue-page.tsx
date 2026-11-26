'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RequireRole, useSession } from '@/entities/session';
import {
  getMentorQueueQueryKey,
  getMentorReviewsQueryKey,
  useMentorClaim,
  useMentorQueue,
  useMentorReviews,
} from '@/shared/api';
import { browserTimeZone, formatShort, pageFrom, useLive, useUrlQuery } from '@/shared/lib';
import { Alert, Badge, Button, Card, Page, Pagination, QueryState, Table } from '@/shared/ui';

const KEYS = ['page'] as const;

const Queue = () => {
  const [query, setQuery] = useUrlQuery(KEYS);
  const queue = useMentorQueue({ page: pageFrom(query.page) });
  const reviews = useMentorReviews();
  const { account } = useSession();
  const router = useRouter();
  const client = useQueryClient();
  const claim = useMentorClaim({
    mutation: {
      onSuccess: ({ submissionId }) => {
        router.push(`/mentor/submissions/${submissionId}`);
      },
    },
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: getMentorQueueQueryKey() });
    void client.invalidateQueries({ queryKey: getMentorReviewsQueryKey() });
  };
  useLive({
    room: account ? { kind: 'mentor', id: account.id } : null,
    event: 'queue.changed',
    onEvent: refresh,
    onResync: refresh,
  });
  const zone = account?.timeZone ?? browserTimeZone();
  return (
    <Page title="Review queue">
      {claim.error ? <Alert>{claim.error.message}</Alert> : null}
      <Card label="In review">
        <QueryState query={reviews}>
          {(data) => (
            <>
              <h2 className="text-lg font-semibold">
                In review: {data.items.length} of {data.limit}
              </h2>
              <ul>
                {data.items.map((item) => (
                  <li key={item.submissionId}>
                    <Link className="underline" href={`/mentor/submissions/${item.submissionId}`}>
                      {item.studentName} · {item.homeworkTitle}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </QueryState>
        <Button
          pending={claim.isPending}
          onClick={() => {
            claim.mutate({ data: {} });
          }}
        >
          Take the oldest work
        </Button>
      </Card>
      <Card label="Waiting">
        <h2 className="text-lg font-semibold">Waiting, oldest first</h2>
        <QueryState query={queue}>
          {(data) => (
            <>
              <Table caption="Waiting work" headers={['Handed in', 'Student', 'Work', '']}>
                {data.items.map((item) => (
                  <tr key={item.submissionId} data-testid="queue-row">
                    <td>
                      {formatShort(item.submittedAt, zone)}{' '}
                      {item.isLate ? <Badge>Late</Badge> : null}
                    </td>
                    <td>{item.studentName}</td>
                    <td>
                      {item.courseTitle} · {item.homeworkTitle}
                    </td>
                    <td>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          claim.mutate({ data: { submissionId: item.submissionId } });
                        }}
                      >
                        Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </Table>
              <Pagination
                {...data}
                onChange={(page) => {
                  setQuery({ page });
                }}
              />
            </>
          )}
        </QueryState>
      </Card>
    </Page>
  );
};

export const MentorQueuePage = () => (
  <RequireRole role="mentor">
    <Queue />
  </RequireRole>
);

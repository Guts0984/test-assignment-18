'use client';

import { RequireRole } from '@/entities/session';
import { useJobsList, useJobsRetry } from '@/shared/api';
import { formatShort, browserTimeZone, pageFrom, useUrlQuery } from '@/shared/lib';
import { Alert, Button, Page, Pagination, QueryState, Table } from '@/shared/ui';

const KEYS = ['page'] as const;

const Jobs = () => {
  const [query, setQuery] = useUrlQuery(KEYS);
  const jobs = useJobsList({ page: pageFrom(query.page) }, { query: { refetchInterval: 5_000 } });
  const retry = useJobsRetry();
  return (
    <Page title="Failed background jobs">
      {retry.error ? <Alert>{retry.error.message}</Alert> : null}
      <QueryState query={jobs}>
        {(data) =>
          data.items.length === 0 ? (
            <p>Nothing has failed.</p>
          ) : (
            <>
              <Table caption="Failed jobs" headers={['Job', 'Failed', 'Attempts', 'Reason', '']}>
                {data.items.map((job) => (
                  <tr key={job.id}>
                    <td>{job.queue}</td>
                    <td>{formatShort(job.failedAt, browserTimeZone())}</td>
                    <td>{job.attempts}</td>
                    <td>{job.error}</td>
                    <td>
                      <Button
                        variant="secondary"
                        pending={retry.isPending}
                        onClick={() => {
                          retry.mutate({ id: job.id });
                        }}
                      >
                        Retry
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
          )
        }
      </QueryState>
    </Page>
  );
};

export const ManagerJobsPage = () => (
  <RequireRole role="manager">
    <Jobs />
  </RequireRole>
);

'use client';

import Link from 'next/link';
import { useState } from 'react';
import { STATUS_LABELS } from '@/entities/enrollment';
import { RequireRole } from '@/entities/session';
import { useRosterSearch } from '@/shared/api';
import { formatDay, pageFrom, useUrlQuery } from '@/shared/lib';
import { Button, Card, Input, Page, Pagination, QueryState } from '@/shared/ui';

const KEYS = ['q', 'page'] as const;

const Search = () => {
  const [query, setQuery] = useUrlQuery(KEYS);
  const [q, setQ] = useState(query.q ?? '');
  const found = useRosterSearch(
    { q: query.q ?? '', page: pageFrom(query.page) },
    { query: { enabled: (query.q?.length ?? 0) >= 2 } },
  );
  return (
    <Page title="Students">
      <form
        role="search"
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery({ q });
        }}
      >
        <Input
          label="Name or e-mail (at least 2 characters)"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
          }}
        />
        <Button type="submit" disabled={q.trim().length < 2}>
          Search
        </Button>
      </form>
      {(query.q?.length ?? 0) >= 2 ? (
        <QueryState query={found}>
          {(data) => (
            <>
              {data.items.map((student) => (
                <Card key={student.studentId}>
                  <h2 className="font-semibold">
                    {student.fullName} · {student.email}
                  </h2>
                  <ul>
                    {student.enrollments.map((row) => (
                      <li key={row.enrollmentId}>
                        <Link className="underline" href={`/manager/cohorts/${row.cohortId}`}>
                          {row.courseTitle}, {formatDay(row.startDate)}
                        </Link>{' '}
                        · {STATUS_LABELS[row.status]}
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
              <Pagination
                {...data}
                onChange={(page) => {
                  setQuery({ ...query, page });
                }}
              />
            </>
          )}
        </QueryState>
      ) : null}
    </Page>
  );
};

export const ManagerStudentsPage = () => (
  <RequireRole role="manager">
    <Search />
  </RequireRole>
);

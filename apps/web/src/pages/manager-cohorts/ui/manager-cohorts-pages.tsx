'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RequireRole } from '@/entities/session';
import { CreateCohort } from '@/features/manage-cohort';
import { useCohortsList } from '@/shared/api';
import { formatDay, formatMoney, pageFrom, useUrlQuery } from '@/shared/lib';
import { Button, Card, Input, Page, Pagination, QueryState, Table } from '@/shared/ui';

const KEYS = ['q', 'page'] as const;

const Cohorts = () => {
  const [query, setQuery] = useUrlQuery(KEYS);
  const [q, setQ] = useState(query.q ?? '');
  const cohorts = useCohortsList({
    page: pageFrom(query.page),
    ...(query.q ? { q: query.q } : {}),
  });
  return (
    <Page title="Cohorts">
      <Link className="underline" href="/manager/cohorts/new">
        Create a cohort
      </Link>
      <form
        role="search"
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery({ q });
        }}
      >
        <Input
          label="Course title"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
          }}
        />
        <Button type="submit">Search</Button>
      </form>
      <QueryState query={cohorts}>
        {(data) => (
          <>
            <Table caption="Cohorts" headers={['Course', 'Starts', 'Mentor', 'Seats', 'Price']}>
              {data.items.map((cohort) => (
                <tr key={cohort.id}>
                  <td>
                    <Link className="underline" href={`/manager/cohorts/${cohort.id}`}>
                      {cohort.courseTitle}
                    </Link>
                  </td>
                  <td>{formatDay(cohort.startDate)}</td>
                  <td>{cohort.mentorName}</td>
                  <td>
                    {cohort.seatsTaken}/{cohort.capacity}
                  </td>
                  <td>{formatMoney(cohort.priceMinor, cohort.currency)}</td>
                </tr>
              ))}
            </Table>
            <Pagination
              {...data}
              onChange={(page) => {
                setQuery({ ...query, page });
              }}
            />
          </>
        )}
      </QueryState>
    </Page>
  );
};

const NewCohort = () => {
  const router = useRouter();
  return (
    <Page title="New cohort">
      <Card>
        <CreateCohort
          onCreated={(id) => {
            router.push(`/manager/cohorts/${id}`);
          }}
        />
      </Card>
    </Page>
  );
};

export const ManagerCohortsPage = () => (
  <RequireRole role="manager">
    <Cohorts />
  </RequireRole>
);

export const NewCohortPage = () => (
  <RequireRole role="manager">
    <NewCohort />
  </RequireRole>
);

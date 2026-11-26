'use client';

import { STATUS_LABELS } from '@/entities/enrollment';
import { RequireRole } from '@/entities/session';
import { useMentorStudents } from '@/shared/api';
import { pageFrom, useUrlQuery } from '@/shared/lib';
import { Page, Pagination, QueryState, Table } from '@/shared/ui';

const KEYS = ['page'] as const;

const Students = () => {
  const [query, setQuery] = useUrlQuery(KEYS);
  const students = useMentorStudents({ page: pageFrom(query.page) });
  return (
    <Page title="My students">
      <QueryState query={students}>
        {(data) => (
          <>
            <Table caption="Students" headers={['Student', 'Course', 'Status', 'Progress']}>
              {data.items.map((row) => (
                <tr key={row.enrollmentId}>
                  <td>
                    {row.studentName}
                    <br />
                    <span className="text-slate-500">{row.email}</span>
                  </td>
                  <td>{row.courseTitle}</td>
                  <td>{STATUS_LABELS[row.status]}</td>
                  <td>
                    {row.accepted} accepted, {row.submitted} handed in, of {row.total}
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
    </Page>
  );
};

export const MentorStudentsPage = () => (
  <RequireRole role="mentor">
    <Students />
  </RequireRole>
);

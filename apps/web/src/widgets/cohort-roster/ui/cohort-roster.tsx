'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { STATUS_LABELS } from '@/entities/enrollment';
import { StudentActions } from '@/features/manage-roster';
import {
  getCohortsGetQueryKey,
  getRosterPaymentsQueryKey,
  getRosterStudentsQueryKey,
  getRosterWaitlistQueryKey,
  useRosterPayments,
  useRosterStudents,
  useRosterWaitlist,
} from '@/shared/api';
import { formatMoney, formatShort, useLive } from '@/shared/lib';
import { Card, Input, Pagination, QueryState, Table } from '@/shared/ui';

/** Students, waiting list and money of one cohort, refreshed the moment anything changes. */
export const CohortRoster = ({
  cohortId,
  courseId,
  timeZone,
}: {
  cohortId: string;
  courseId: string;
  timeZone: string;
}) => {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [moneyPage, setMoneyPage] = useState(1);
  const client = useQueryClient();
  const students = useRosterStudents(cohortId, { page, ...(q ? { q } : {}) });
  const waitlist = useRosterWaitlist(cohortId);
  const money = useRosterPayments(cohortId, { page: moneyPage });
  const refresh = () => {
    for (const queryKey of [
      getCohortsGetQueryKey(cohortId),
      getRosterStudentsQueryKey(cohortId),
      getRosterWaitlistQueryKey(cohortId),
      getRosterPaymentsQueryKey(cohortId),
    ]) {
      void client.invalidateQueries({ queryKey });
    }
  };
  useLive({
    room: { kind: 'cohort-staff', id: cohortId },
    event: 'roster.changed',
    onEvent: refresh,
    onResync: refresh,
  });
  return (
    <>
      <Card label="Students">
        <h2 className="text-lg font-semibold">Students</h2>
        <Input
          label="Search by name or e-mail"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
          }}
        />
        <QueryState query={students}>
          {(data) => (
            <>
              <Table caption="Students" headers={['Student', 'Status', 'Paid', 'Actions']}>
                {data.items.map((row) => (
                  <tr key={row.enrollmentId} data-testid="roster-row">
                    <td>
                      {row.fullName}
                      <br />
                      <span className="text-slate-500">{row.email}</span>
                    </td>
                    <td>{STATUS_LABELS[row.status]}</td>
                    <td>{formatMoney(row.paidMinor, row.currency)}</td>
                    <td>
                      {['held', 'offered', 'paid'].includes(row.status) ? (
                        <StudentActions
                          enrollmentId={row.enrollmentId}
                          courseId={courseId}
                          cohortId={cohortId}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </Table>
              <Pagination {...data} onChange={setPage} />
            </>
          )}
        </QueryState>
      </Card>
      <Card label="Waiting list">
        <h2 className="text-lg font-semibold">Waiting list</h2>
        <QueryState query={waitlist}>
          {({ items }) =>
            items.length === 0 ? (
              <p>Nobody is waiting.</p>
            ) : (
              <Table caption="Waiting list" headers={['Student', 'Status', 'Joined']}>
                {items.map((row) => (
                  <tr key={`${row.studentId}-${row.joinedAt}`}>
                    <td>{row.fullName}</td>
                    <td>{row.status.replace('_', ' ')}</td>
                    <td>{formatShort(row.joinedAt, timeZone)}</td>
                  </tr>
                ))}
              </Table>
            )
          }
        </QueryState>
      </Card>
      <Card label="Payments and refunds">
        <h2 className="text-lg font-semibold">Payments and refunds</h2>
        <QueryState query={money}>
          {(data) => (
            <>
              <Table caption="Money" headers={['Student', 'Operation', 'Amount', 'When']}>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td>{row.studentName}</td>
                    <td>{row.kind.replace('_', ' ')}</td>
                    <td>{formatMoney(row.amountMinor, row.currency)}</td>
                    <td>{formatShort(row.at, timeZone)}</td>
                  </tr>
                ))}
              </Table>
              <Pagination {...data} onChange={setMoneyPage} />
            </>
          )}
        </QueryState>
      </Card>
    </>
  );
};

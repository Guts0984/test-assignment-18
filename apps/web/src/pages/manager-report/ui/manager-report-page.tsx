'use client';

import { CURRENCIES } from '@school/shared/money/money';
import { useState } from 'react';
import { RequireRole } from '@/entities/session';
import { useCoursesList, useReportsReport } from '@/shared/api';
import { formatMoney, useUrlQuery } from '@/shared/lib';
import { Alert, Button, Card, Input, Page, QueryState, Select, Table } from '@/shared/ui';
import { reportFromUrl, share } from '../model/period';

const KEYS = ['from', 'to', 'courseId', 'cohortId', 'currency'] as const;
type Filters = Partial<Record<(typeof KEYS)[number], string>>;

const FilterForm = ({ initial, onApply }: { initial: Filters; onApply: (f: Filters) => void }) => {
  const [fields, setFields] = useState(initial);
  const courses = useCoursesList({ pageSize: 100 });
  const bind = (name: (typeof KEYS)[number]) => ({
    value: fields[name] ?? '',
    onChange: (event: { target: { value: string } }) => {
      setFields({ ...fields, [name]: event.target.value });
    },
  });
  return (
    <form
      className="grid gap-3 sm:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(fields);
      }}
    >
      <Input label="From" type="date" {...bind('from')} />
      <Input label="To" type="date" {...bind('to')} />
      <Select label="Course" {...bind('courseId')}>
        <option value="">All courses</option>
        {courses.data?.items.map((course) => (
          <option key={course.id} value={course.id}>
            {course.title}
          </option>
        ))}
      </Select>
      <Select label="Currency" {...bind('currency')}>
        <option value="">All</option>
        {CURRENCIES.map((currency) => (
          <option key={currency}>{currency}</option>
        ))}
      </Select>
      <div>
        <Button type="submit">Show</Button>
      </div>
    </form>
  );
};

const Report = () => {
  const [query, setQuery] = useUrlQuery(KEYS);
  const [now] = useState(() => new Date());
  const request = reportFromUrl(query, now);
  const valid = 'query' in request ? request.query : undefined;
  const report = useReportsReport(valid ?? { from: '', to: '' }, {
    query: { enabled: valid !== undefined },
  });
  return (
    <Page title="Report">
      <Card label="Filters">
        <FilterForm
          key={JSON.stringify(query)}
          initial={{ ...(valid ?? {}), ...query }}
          onApply={setQuery}
        />
      </Card>
      {'problem' in request ? (
        <Alert>{request.problem}</Alert>
      ) : (
        <QueryState query={report}>
          {(data) => (
            <>
              <Card label="Occupancy">
                <h2 className="text-lg font-semibold">
                  Occupancy of cohorts starting in the period
                </h2>
                <p data-testid="occupancy">
                  {data.occupancy.cohorts} cohorts, {data.occupancy.seatsTaken} of{' '}
                  {data.occupancy.capacity} seats
                </p>
                <Table caption="By course" headers={['Course', 'Cohorts', 'Seats taken']}>
                  {data.occupancy.byCourse.map((row) => (
                    <tr key={row.courseId}>
                      <td>{row.title}</td>
                      <td>{row.cohorts}</td>
                      <td>
                        {row.seatsTaken}/{row.capacity}
                      </td>
                    </tr>
                  ))}
                </Table>
              </Card>
              <Card label="Money">
                <h2 className="text-lg font-semibold">Revenue and refunds</h2>
                <Table caption="Money" headers={['Currency', 'Paid', 'Refunded']}>
                  {data.money.map((row) => (
                    <tr key={row.currency}>
                      <td>{row.currency}</td>
                      <td>{formatMoney(row.paidMinor, row.currency)}</td>
                      <td>{formatMoney(row.refundedMinor, row.currency)}</td>
                    </tr>
                  ))}
                </Table>
              </Card>
              <Card label="Students">
                <p>Waiting-list conversion: {share(data.waitlist)}</p>
                <p>Homework handed in on time: {share(data.homeworkOnTime)}</p>
                <p>Certificates issued: {data.certificatesIssued}</p>
              </Card>
            </>
          )}
        </QueryState>
      )}
    </Page>
  );
};

export const ManagerReportPage = () => (
  <RequireRole role="manager">
    <Report />
  </RequireRole>
);

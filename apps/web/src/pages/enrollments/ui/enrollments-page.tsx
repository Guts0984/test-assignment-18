'use client';

import Link from 'next/link';
import { STATUS_LABELS } from '@/entities/enrollment';
import { RequireRole } from '@/entities/session';
import { useEnrollmentsList } from '@/shared/api';
import { formatDay, formatMoney } from '@/shared/lib';
import { Badge, Card, Page, QueryState } from '@/shared/ui';

const List = () => {
  const enrollments = useEnrollmentsList();
  return (
    <Page title="Enrollments">
      <QueryState query={enrollments}>
        {({ items }) =>
          items.length === 0 ? (
            <p>Nothing here yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((item) => (
                <li key={item.id}>
                  <Card>
                    <Link
                      className="font-semibold underline"
                      href={`/account/enrollments/${item.id}`}
                    >
                      {item.courseTitle}
                    </Link>
                    <p>
                      Starts {formatDay(item.startDate)} ·{' '}
                      {formatMoney(item.priceMinor, item.currency)}{' '}
                      <Badge>{STATUS_LABELS[item.status]}</Badge>
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Page>
  );
};

export const EnrollmentsPage = () => (
  <RequireRole role="student">
    <List />
  </RequireRole>
);

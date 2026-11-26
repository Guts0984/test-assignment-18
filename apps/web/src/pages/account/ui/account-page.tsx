'use client';

import Link from 'next/link';
import { RequireRole } from '@/entities/session';
import { LeaveWaitlist } from '@/features/waitlist';
import { useCabinetGet, useWaitlistList } from '@/shared/api';
import { formatDay } from '@/shared/lib';
import { Card, Page, QueryState } from '@/shared/ui';
import { CourseStudy } from '@/widgets/course-study';

const Waiting = () => {
  const waiting = useWaitlistList();
  if (!waiting.data || waiting.data.items.length === 0) return null;
  return (
    <Card label="Waiting lists">
      <h2 className="text-lg font-semibold">Waiting lists</h2>
      <ul className="flex flex-col gap-2">
        {waiting.data.items.map((item) => (
          <li key={item.cohortId} className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <span>
              {item.courseTitle}, starts {formatDay(item.startDate)} ·{' '}
              {item.status === 'offered' ? (
                <Link
                  className="underline"
                  href={`/account/enrollments/${item.enrollmentId ?? ''}`}
                >
                  A seat is yours: pay now
                </Link>
              ) : (
                `number ${item.place ?? '?'} in line`
              )}
            </span>
            <LeaveWaitlist
              cohortId={item.cohortId}
              label={item.status === 'offered' ? 'Decline the offer' : 'Leave the list'}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
};

const Studies = () => {
  const cabinet = useCabinetGet({ query: { refetchInterval: 15_000 } });
  return (
    <Page title="My studies">
      <Waiting />
      <QueryState query={cabinet}>
        {(data) => (
          <>
            <p className="text-sm text-slate-600">Times are shown in {data.timeZone}.</p>
            {data.courses.length === 0 ? (
              <p>
                You are not enrolled yet.{' '}
                <Link className="underline" href="/">
                  Find a course
                </Link>
              </p>
            ) : null}
            {data.courses.map((course) => (
              <CourseStudy
                key={course.enrollmentId}
                course={course}
                timeZone={data.timeZone}
                serverNow={data.serverNow}
              />
            ))}
          </>
        )}
      </QueryState>
    </Page>
  );
};

export const AccountPage = () => (
  <RequireRole role="student">
    <Studies />
  </RequireRole>
);

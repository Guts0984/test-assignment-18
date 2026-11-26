'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/entities/session';
import { BookSeat } from '@/features/book-seat';
import { JoinWaitlist } from '@/features/waitlist';
import { getCatalogCourseQueryKey, useCatalogCourse } from '@/shared/api';
import {
  browserTimeZone,
  formatDay,
  formatMoney,
  formatShort,
  useLive,
  useRouteParam,
  usePath,
} from '@/shared/lib';
import { Card, Page, QueryState } from '@/shared/ui';

export const CoursePage = () => {
  const id = useRouteParam('id');
  const course = useCatalogCourse(id);
  const { account } = useSession();
  const pathname = usePath();
  const router = useRouter();
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: getCatalogCourseQueryKey(id) });
  };
  useLive({
    room: { kind: 'catalog' },
    event: 'seats.changed',
    onEvent: refresh,
    onResync: refresh,
  });
  const zone = account?.timeZone ?? browserTimeZone();
  return (
    <Page title={course.data?.title ?? 'Course'}>
      <QueryState query={course}>
        {(data) => (
          <>
            <p>
              {data.direction} · {data.schoolName}
            </p>
            <p className="whitespace-pre-wrap">{data.description}</p>
            {data.cohorts.length === 0 ? <p>No cohort is open for enrollment.</p> : null}
            {data.cohorts.map((cohort) => (
              <Card key={cohort.cohortId} label={`Cohort starting ${cohort.startDate}`}>
                <div data-testid={`cohort-${cohort.cohortId}`} className="flex flex-col gap-2">
                  <h2 className="text-lg font-semibold">
                    Starts {formatDay(cohort.startDate)} ·{' '}
                    {formatMoney(cohort.priceMinor, cohort.currency)}
                  </h2>
                  <p data-testid="free-seats">
                    {cohort.freeSeats > 0
                      ? `${cohort.freeSeats} of ${cohort.capacity} seats free`
                      : 'No free seats'}
                  </p>
                  <details>
                    <summary className="min-h-11 cursor-pointer py-2">
                      Schedule: {cohort.lessons.length} lessons, shown in {zone}
                    </summary>
                    <ol className="list-decimal pl-6">
                      {cohort.lessons.map((lesson) => (
                        <li key={lesson.id}>
                          {formatShort(lesson.startsAt, zone)} ({lesson.localTime} {cohort.timeZone}
                          )
                        </li>
                      ))}
                    </ol>
                  </details>
                  {account?.role === 'student' ? (
                    <BookSeat
                      cohortId={cohort.cohortId}
                      full={cohort.freeSeats === 0}
                      whenFull={<JoinWaitlist cohortId={cohort.cohortId} />}
                      onBooked={(enrollmentId, promoProblem) => {
                        const note = promoProblem
                          ? `?promo=${encodeURIComponent(promoProblem)}`
                          : '';
                        router.push(`/account/enrollments/${enrollmentId}${note}`);
                      }}
                    />
                  ) : account === null ? (
                    <Link
                      className="underline"
                      href={`/login?next=${encodeURIComponent(pathname)}`}
                    >
                      Sign in to book a seat
                    </Link>
                  ) : null}
                </div>
              </Card>
            ))}
          </>
        )}
      </QueryState>
    </Page>
  );
};

'use client';

import { RequireRole } from '@/entities/session';
import { CohortSettings, RescheduleLesson } from '@/features/manage-cohort';
import { useCohortsGet } from '@/shared/api';
import { formatDay, formatShort, useRouteParam } from '@/shared/lib';
import { Card, Page, QueryState } from '@/shared/ui';
import { CohortRoster } from '@/widgets/cohort-roster';

const Detail = () => {
  const id = useRouteParam('id');
  const cohort = useCohortsGet(id);
  return (
    <Page title={cohort.data?.courseTitle ?? 'Cohort'}>
      <QueryState query={cohort}>
        {(data) => (
          <>
            <p data-testid="seat-summary">
              Starts {formatDay(data.startDate)} · {data.timeZone} · {data.seatsTaken} of{' '}
              {data.capacity} seats taken · mentor {data.mentorName}
            </p>
            <Card label="Settings">
              <CohortSettings
                key={`${data.capacity}-${data.priceMinor}-${data.mentorId}`}
                cohort={data}
              />
            </Card>
            <CohortRoster cohortId={data.id} courseId={data.courseId} timeZone={data.timeZone} />
            <Card label="Schedule">
              <h2 className="text-lg font-semibold">Schedule</h2>
              <ol className="flex flex-col gap-3">
                {data.lessons.map((lesson) => (
                  <li key={lesson.id} className="flex flex-col gap-1">
                    <span>
                      Lesson {lesson.seq}: {formatShort(lesson.startsAt, data.timeZone)}
                    </span>
                    <details>
                      <summary className="min-h-11 cursor-pointer py-2">Move this lesson</summary>
                      <RescheduleLesson
                        key={lesson.startsAt}
                        lessonId={lesson.id}
                        localDate={lesson.localDate}
                        localTime={lesson.localTime}
                      />
                    </details>
                  </li>
                ))}
              </ol>
            </Card>
          </>
        )}
      </QueryState>
    </Page>
  );
};

export const ManagerCohortPage = () => (
  <RequireRole role="manager">
    <Detail />
  </RequireRole>
);

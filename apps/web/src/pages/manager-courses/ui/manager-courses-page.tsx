'use client';

import { RequireRole } from '@/entities/session';
import { CourseForm } from '@/features/manage-courses';
import { useCoursesList } from '@/shared/api';
import { pageFrom, useUrlQuery } from '@/shared/lib';
import { Card, Page, Pagination, QueryState } from '@/shared/ui';

const KEYS = ['page'] as const;

const Courses = () => {
  const [query, setQuery] = useUrlQuery(KEYS);
  const courses = useCoursesList({ page: pageFrom(query.page) });
  return (
    <Page title="Courses">
      <Card label="New course">
        <h2 className="text-lg font-semibold">New course</h2>
        <CourseForm />
      </Card>
      <QueryState query={courses}>
        {(data) => (
          <>
            {data.items.map((course) => (
              <Card key={course.id}>
                <details>
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                    {course.title} · {course.direction}
                  </summary>
                  <CourseForm course={course} />
                </details>
              </Card>
            ))}
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

export const ManagerCoursesPage = () => (
  <RequireRole role="manager">
    <Courses />
  </RequireRole>
);

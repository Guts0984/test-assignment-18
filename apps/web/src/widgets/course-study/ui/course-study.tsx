'use client';

import { SubmitHomework } from '@/features/submit-homework';
import { type CabinetDtoOutputCoursesItem } from '@/shared/api';
import { formatShort } from '@/shared/lib';
import { Badge, Card } from '@/shared/ui';

type Lesson = CabinetDtoOutputCoursesItem['lessons'][number];

const WORK_LABELS = {
  submitted: 'Waiting for review',
  in_review: 'Being reviewed',
  accepted: 'Accepted',
  returned: 'Returned for rework',
} as const;

const Homework = ({
  homework,
  timeZone,
  serverNow,
}: {
  homework: NonNullable<Lesson['homework']>;
  timeZone: string;
  serverNow: string;
}) => {
  const { submission } = homework;
  const open = !submission || ['submitted', 'returned'].includes(submission.status);
  const late = Date.parse(serverNow) > Date.parse(homework.deadlineAt);
  return (
    <details className="rounded-md border border-slate-200 p-2" data-testid="homework">
      <summary className="min-h-11 cursor-pointer py-2">
        {homework.title} · due {formatShort(homework.deadlineAt, timeZone)}{' '}
        <Badge>{submission ? WORK_LABELS[submission.status] : 'Not handed in'}</Badge>
        {submission?.isLate ? <Badge>Late</Badge> : null}
      </summary>
      <div className="flex flex-col gap-2">
        {submission?.reviews.map((review) => (
          <blockquote key={review.reviewedAt} className="border-l-4 border-slate-300 pl-2">
            <strong>{review.verdict === 'accepted' ? 'Accepted' : 'Returned'}</strong>
            {review.score === null ? '' : ` · ${review.score}/100`}
            <br />
            {review.comment}
          </blockquote>
        ))}
        {submission?.file ? (
          <a className="underline" href={`/api/submissions/${submission.id}/file`}>
            Download {submission.file.name}
          </a>
        ) : null}
        {open ? (
          <SubmitHomework
            homeworkId={homework.id}
            initialBody={submission?.body ?? ''}
            late={late}
          />
        ) : (
          <p className="whitespace-pre-wrap">{submission.body}</p>
        )}
      </div>
    </details>
  );
};

/** One course of a student: progress, then every lesson with its homework. */
export const CourseStudy = ({
  course,
  timeZone,
  serverNow,
}: {
  course: CabinetDtoOutputCoursesItem;
  timeZone: string;
  serverNow: string;
}) => (
  <Card label={course.courseTitle}>
    <h2 className="text-lg font-semibold">{course.courseTitle}</h2>
    <p data-testid="progress">
      Accepted {course.progress.accepted} of {course.progress.total} homework tasks. A certificate
      needs {course.progress.requiredPercent}%.
    </p>
    <progress
      className="w-full"
      max={Math.max(1, course.progress.total)}
      value={course.progress.accepted}
      aria-label="Homework progress"
    />
    {course.certificate ? (
      <a className="underline" href={`/api/certificates/${course.certificate.id}/pdf`}>
        Download certificate No. {course.certificate.number}
      </a>
    ) : null}
    <ol className="flex flex-col gap-3">
      {course.lessons.map((lesson) => (
        <li key={lesson.id} className="flex flex-col gap-1">
          <span data-testid="lesson-time">
            Lesson {lesson.seq} · {formatShort(lesson.startsAt, timeZone)}
          </span>
          {lesson.homework ? (
            <Homework homework={lesson.homework} timeZone={timeZone} serverNow={serverNow} />
          ) : null}
        </li>
      ))}
    </ol>
  </Card>
);

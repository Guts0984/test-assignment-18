import { Inject, Injectable } from '@nestjs/common';
import { CERTIFICATE_MIN_ACCEPTED_PERCENT } from '@school/shared/certificate/eligibility';
import { type Cabinet } from '@school/shared/schemas/homework';
import { type EnrollmentStatus } from '@school/shared/status/enrollment';
import { DEPS, type Deps } from '../../infra/deps';
import { toLesson } from '../catalog/domain';
import { SUBMISSION_INCLUDE, toSubmissionView } from '../homework/view';

@Injectable()
export class CabinetService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  /** Everything a student studies: schedule, homework with verdicts, progress, certificates. */
  async get(studentId: string): Promise<Cabinet> {
    const [student, enrollments, now] = await Promise.all([
      this.deps.db.user.findUniqueOrThrow({ where: { id: studentId } }),
      this.deps.db.enrollment.findMany({
        where: { studentId, status: { in: ['paid', 'completed'] } },
        include: {
          certificate: true,
          submissions: { include: SUBMISSION_INCLUDE },
          cohort: {
            include: {
              course: true,
              lessons: { include: { homework: true }, orderBy: { startsAt: 'asc' } },
            },
          },
        },
        orderBy: [{ cohort: { startsAt: 'desc' } }, { id: 'asc' }],
      }),
      this.deps.time.now(),
    ]);
    return {
      timeZone: student.timeZone,
      serverNow: now.toISOString(),
      courses: enrollments.map((enrollment) => {
        const { cohort, submissions, certificate } = enrollment;
        return {
          enrollmentId: enrollment.id,
          cohortId: cohort.id,
          courseTitle: cohort.course.title,
          status: enrollment.status as EnrollmentStatus,
          cohortTimeZone: cohort.timeZone,
          progress: {
            accepted: submissions.filter((s) => s.status === 'accepted').length,
            total: cohort.lessons.filter((lesson) => lesson.homework).length,
            requiredPercent: CERTIFICATE_MIN_ACCEPTED_PERCENT,
          },
          lessons: cohort.lessons.map((lesson) => {
            const { homework } = lesson;
            const submission = submissions.find((s) => s.homeworkId === homework?.id);
            return {
              ...toLesson(lesson),
              homework: homework
                ? {
                    id: homework.id,
                    title: homework.title,
                    deadlineAt: homework.deadlineAt.toISOString(),
                    submission: submission ? toSubmissionView(submission) : null,
                  }
                : null,
            };
          }),
          certificate: certificate ? { id: certificate.id, number: certificate.number } : null,
        };
      }),
    };
  }
}

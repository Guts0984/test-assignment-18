import { Inject, Injectable } from '@nestjs/common';
import { claimSubmission, releaseSubmission, reviewSubmission } from '@school/db/repo/review';
import { type ReviewInput } from '@school/shared/schemas/homework';
import { type EnrollmentStatus } from '@school/shared/status/enrollment';
import { rejected } from '../../common/errors/rejections';
import { runBusiness } from '../../infra/business';
import { DEPS, type Deps } from '../../infra/deps';
import { SUBMISSION_INCLUDE, toSubmissionView } from '../homework/view';
import { claimedWork, countWaitingWork, toQueueItem, waitingWork } from './queue';

type Page = { readonly page: number; readonly pageSize: number };

@Injectable()
export class MentorService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  async queue(mentorId: string, query: Page) {
    const window = { limit: query.pageSize, offset: (query.page - 1) * query.pageSize };
    const [rows, total] = await Promise.all([
      waitingWork(this.deps.db, mentorId, window),
      countWaitingWork(this.deps.db, mentorId),
    ]);
    return { items: rows.map(toQueueItem), total, ...query };
  }

  async reviews(mentorId: string) {
    const rows = await claimedWork(this.deps.db, mentorId);
    return { limit: this.deps.env.MENTOR_REVIEW_LIMIT, items: rows.map(toQueueItem) };
  }

  /** A submission of the mentor's cohorts, or one they still hold. */
  async submission(mentorId: string, id: string) {
    const row = await this.deps.db.submission.findFirst({
      where: {
        id,
        OR: [{ enrollment: { cohort: { mentorId } } }, { reviewerId: mentorId }],
      },
      include: {
        ...SUBMISSION_INCLUDE,
        homework: true,
        enrollment: { include: { student: true, cohort: { include: { course: true } } } },
      },
    });
    if (!row) throw rejected('NOT_FOUND');
    return {
      ...toSubmissionView(row),
      courseTitle: row.enrollment.cohort.course.title,
      homeworkTitle: row.homework.title,
      studentName: row.enrollment.student.fullName,
      deadlineAt: row.homework.deadlineAt.toISOString(),
    };
  }

  async claim(mentorId: string, submissionId: string | undefined) {
    const outcome = await runBusiness(this.deps, (unit) =>
      claimSubmission(unit, {
        mentorId,
        submissionId: submissionId ?? null,
        limit: this.deps.env.MENTOR_REVIEW_LIMIT,
      }),
    );
    if (typeof outcome === 'string') throw rejected(outcome);
    this.deps.realtime.queueChanged([mentorId]);
    return outcome;
  }

  async release(mentorId: string, submissionId: string) {
    const outcome = await runBusiness(this.deps, (unit) =>
      releaseSubmission(unit, { mentorId, submissionId }),
    );
    if (outcome !== 'RELEASED') throw rejected(outcome);
    this.deps.realtime.queueChanged([mentorId]);
  }

  async review(mentorId: string, submissionId: string, input: ReviewInput) {
    const outcome = await runBusiness(this.deps, (unit) =>
      reviewSubmission(unit, { ...input, mentorId, submissionId }),
    );
    if (outcome !== 'REVIEWED') throw rejected(outcome);
    this.deps.realtime.queueChanged([mentorId]);
  }

  async students(mentorId: string, query: Page & { cohortId?: string | undefined }) {
    const where = {
      status: { in: ['paid', 'completed'] },
      cohort: { mentorId },
      ...(query.cohortId ? { cohortId: query.cohortId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.deps.db.enrollment.findMany({
        where,
        include: { student: true, cohort: { include: { course: true } } },
        orderBy: [
          { cohort: { startDate: 'desc' } },
          { student: { fullName: 'asc' } },
          { id: 'asc' },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.deps.db.enrollment.count({ where }),
    ]);
    const [work, tasks] = await Promise.all([
      this.deps.db.submission.groupBy({
        by: ['enrollmentId', 'status'],
        where: { enrollmentId: { in: rows.map((row) => row.id) } },
        _count: true,
      }),
      this.deps.db.homework.groupBy({
        by: ['cohortId'],
        where: { cohortId: { in: rows.map((row) => row.cohortId) } },
        _count: true,
      }),
    ]);
    return {
      items: rows.map((row) => {
        const own = work.filter((item) => item.enrollmentId === row.id);
        return {
          enrollmentId: row.id,
          studentName: row.student.fullName,
          email: row.student.email,
          courseTitle: row.cohort.course.title,
          cohortId: row.cohortId,
          status: row.status as EnrollmentStatus,
          accepted: own.find((item) => item.status === 'accepted')?._count ?? 0,
          submitted: own.reduce((sum, item) => sum + item._count, 0),
          total: tasks.find((item) => item.cohortId === row.cohortId)?._count ?? 0,
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}

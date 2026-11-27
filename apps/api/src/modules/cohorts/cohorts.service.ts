import { Inject, Injectable } from '@nestjs/common';
import { createCohortWithSchedule, rescheduleLesson } from '@school/db/repo/cohort-schedule';
import { inTransaction } from '@school/db/transaction';
import {
  type CreateCohortInput,
  type RescheduleLessonInput,
  type UpdateCohortInput,
} from '@school/shared/schemas/manage';
import { generateLessons } from '@school/shared/schedule/generate';
import { type Principal, schoolOf } from '../../common/auth/principal';
import { apiError } from '../../common/errors/api-error';
import { DEPS, type Deps } from '../../infra/deps';
import { toLesson } from '../catalog/domain';
import { toManagerCohort } from './domain';

const INCLUDE = {
  course: { select: { title: true } },
  mentor: { select: { fullName: true } },
} as const;

@Injectable()
export class CohortsService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  async list(
    schoolId: string,
    query: {
      readonly courseId?: string | undefined;
      readonly q?: string | undefined;
      readonly page: number;
      readonly pageSize: number;
    },
  ) {
    const where = {
      schoolId,
      ...(query.courseId ? { courseId: query.courseId } : {}),
      ...(query.q
        ? { course: { title: { contains: query.q, mode: 'insensitive' as const } } }
        : {}),
    };
    const { page, pageSize } = query;
    const [cohorts, total] = await Promise.all([
      this.deps.db.cohort.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.deps.db.cohort.count({ where }),
    ]);
    return { items: cohorts.map(toManagerCohort), total, page, pageSize };
  }

  async get(schoolId: string, id: string) {
    const cohort = await this.deps.db.cohort.findFirst({
      where: { id, schoolId },
      include: { ...INCLUDE, lessons: { orderBy: { startsAt: 'asc' } } },
    });
    if (!cohort) throw apiError('NOT_FOUND', 'No such cohort');
    return { ...toManagerCohort(cohort), lessons: cohort.lessons.map(toLesson) };
  }

  async mentors(schoolId: string) {
    const items = await this.deps.db.user.findMany({
      where: { schoolId, role: 'mentor', disabledAt: null },
      select: { id: true, fullName: true },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    });
    return { items };
  }

  async create(user: Principal, input: CreateCohortInput) {
    const schoolId = schoolOf(user);
    const now = await this.deps.time.now();
    const [first] = generateLessons({
      ...input.schedule,
      startDate: input.startDate,
      timeZone: input.timeZone,
      durationMinutes: input.lessonMinutes,
    });
    if (!first || first.startsAt <= now) {
      throw apiError('VALIDATION_FAILED', 'Check the highlighted fields', [
        { path: 'startDate', message: 'The first lesson must be in the future' },
      ]);
    }
    const id = await inTransaction(this.deps.db, async (tx) => {
      const course = await tx.course.findFirst({ where: { id: input.courseId, schoolId } });
      if (!course) throw apiError('NOT_FOUND', 'No such course');
      await this.requireMentor(tx, schoolId, input.mentorId);
      return createCohortWithSchedule(
        tx,
        { ...input, schoolId },
        { actor: { kind: 'manager', id: user.id }, now },
      );
    });
    return this.get(schoolId, id);
  }

  async update(schoolId: string, id: string, change: UpdateCohortInput) {
    const before = await this.deps.db.cohort.findFirst({ where: { id, schoolId } });
    await inTransaction(this.deps.db, async (tx) => {
      if (change.mentorId) await this.requireMentor(tx, schoolId, change.mentorId);
      const { count } = await tx.cohort.updateMany({
        where: { id, schoolId },
        data: {
          ...(change.mentorId === undefined ? {} : { mentorId: change.mentorId }),
          ...(change.priceMinor === undefined ? {} : { priceMinor: change.priceMinor }),
        },
      });
      if (count === 0) throw apiError('NOT_FOUND', 'No such cohort');
    });
    if (before && change.mentorId && change.mentorId !== before.mentorId) {
      this.deps.realtime.leaveCohort(before.mentorId, id);
      this.deps.realtime.queueChanged([before.mentorId, change.mentorId]);
    }
    return this.get(schoolId, id);
  }

  async reschedule(schoolId: string, lessonId: string, input: RescheduleLessonInput) {
    const now = await this.deps.time.now();
    const result = await inTransaction(this.deps.db, (tx) =>
      rescheduleLesson(tx, { lessonId, schoolId, ...input, now }),
    );
    if (result === 'NOT_FOUND') throw apiError('NOT_FOUND', 'No such lesson');
    if (result === 'LESSON_STARTED') {
      throw apiError('INVALID_TRANSITION', 'A lesson that has started cannot be moved');
    }
    if (result === 'IN_THE_PAST') {
      throw apiError('VALIDATION_FAILED', 'Check the highlighted fields', [
        { path: 'localDate', message: 'The new time must be in the future' },
      ]);
    }
    return this.get(schoolId, result.cohortId);
  }

  /** The row lock stops the mentor from being disabled until the cohort is saved. */
  private async requireMentor(
    tx: Parameters<Parameters<typeof inTransaction>[1]>[0],
    schoolId: string,
    mentorId: string,
  ): Promise<void> {
    const [mentor] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
       WHERE id = ${mentorId}::uuid AND school_id = ${schoolId}::uuid
         AND role = 'mentor' AND disabled_at IS NULL
         FOR SHARE`;
    if (!mentor) {
      throw apiError('VALIDATION_FAILED', 'Check the highlighted fields', [
        { path: 'mentorId', message: 'Choose an active mentor of your school' },
      ]);
    }
  }
}

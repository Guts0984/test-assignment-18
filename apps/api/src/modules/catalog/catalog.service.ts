import { Inject, Injectable } from '@nestjs/common';
import { type CatalogQuery, type CourseDetail } from '@school/shared/schemas/catalog';
import { apiError } from '../../common/errors/api-error';
import { DEPS, type Deps } from '../../infra/deps';
import { toCatalogCohort, toLesson } from './domain';
import { countOpenCohorts, findOpenCohorts } from './repo/search';

const COURSE_COHORT_LIMIT = 50;

@Injectable()
export class CatalogService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  async search(query: CatalogQuery) {
    const filter = { ...query, now: await this.deps.time.now() };
    const { page, pageSize } = query;
    const [rows, total] = await Promise.all([
      findOpenCohorts(this.deps.db, filter, { limit: pageSize, offset: (page - 1) * pageSize }),
      countOpenCohorts(this.deps.db, filter),
    ]);
    return { items: rows.map(toCatalogCohort), total, page, pageSize };
  }

  async directions() {
    const rows = await this.deps.db.course.findMany({
      distinct: ['direction'],
      select: { direction: true },
      orderBy: { direction: 'asc' },
    });
    return { items: rows.map((row) => row.direction) };
  }

  async course(id: string): Promise<CourseDetail> {
    const course = await this.deps.db.course.findUnique({
      where: { id },
      include: { school: true },
    });
    if (!course) throw apiError('NOT_FOUND', 'No such course');
    const now = await this.deps.time.now();
    const cohorts = await findOpenCohorts(
      this.deps.db,
      { courseId: id, now },
      { limit: COURSE_COHORT_LIMIT, offset: 0 },
    );
    const lessons = await this.deps.db.lesson.findMany({
      where: { cohortId: { in: cohorts.map((cohort) => cohort.cohort_id) } },
      orderBy: { startsAt: 'asc' },
    });
    return {
      id: course.id,
      title: course.title,
      direction: course.direction,
      description: course.description,
      schoolName: course.school.name,
      cohorts: cohorts.map((row) => ({
        ...toCatalogCohort(row),
        lessons: lessons.filter((lesson) => lesson.cohortId === row.cohort_id).map(toLesson),
      })),
    };
  }
}

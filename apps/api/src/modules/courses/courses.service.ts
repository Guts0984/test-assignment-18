import { Inject, Injectable } from '@nestjs/common';
import { type CreateCourseInput, type UpdateCourseInput } from '@school/shared/schemas/manage';
import { apiError } from '../../common/errors/api-error';
import { DEPS, type Deps } from '../../infra/deps';

const SELECT = { id: true, title: true, direction: true, description: true } as const;

@Injectable()
export class CoursesService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  async list(
    schoolId: string,
    query: { readonly q?: string | undefined; readonly page: number; readonly pageSize: number },
  ) {
    const where = {
      schoolId,
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };
    const { page, pageSize } = query;
    const [items, total] = await Promise.all([
      this.deps.db.course.findMany({
        where,
        select: SELECT,
        orderBy: [{ title: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.deps.db.course.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  create(schoolId: string, input: CreateCourseInput) {
    return this.deps.db.course.create({ data: { ...input, schoolId }, select: SELECT });
  }

  async update(schoolId: string, id: string, change: UpdateCourseInput) {
    const data = {
      ...(change.title === undefined ? {} : { title: change.title }),
      ...(change.direction === undefined ? {} : { direction: change.direction }),
      ...(change.description === undefined ? {} : { description: change.description }),
    };
    const { count } = await this.deps.db.course.updateMany({ where: { id, schoolId }, data });
    if (count === 0) throw apiError('NOT_FOUND', 'No such course');
    return this.deps.db.course.findUniqueOrThrow({ where: { id }, select: SELECT });
  }
}

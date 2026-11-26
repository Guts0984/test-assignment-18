import { Inject, Injectable } from '@nestjs/common';
import { type QueueName } from '@school/shared/jobs/registry';
import { retryJob } from '@school/shared/jobs/retry';
import { rejected } from '../../common/errors/rejections';
import { DEPS, type Deps } from '../../infra/deps';

@Injectable()
export class JobsService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  async list(schoolId: string, query: { page: number; pageSize: number }) {
    const where = { schoolId, resolvedAt: null };
    const [rows, total] = await Promise.all([
      this.deps.db.jobFailure.findMany({
        where,
        orderBy: [{ failedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.deps.db.jobFailure.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        queue: row.queue as QueueName,
        recordId: row.jobId,
        error: row.error,
        attempts: row.attempts,
        failedAt: row.failedAt.toISOString(),
      })),
      total,
      ...query,
    };
  }

  /**
   * Runs a failed job again. Marking it resolved comes first and only once, so two clicks make
   * one retry; if Redis is down the sweeper picks the work up from Postgres.
   */
  async retry(schoolId: string, id: string): Promise<void> {
    const now = await this.deps.time.now();
    const { count } = await this.deps.db.jobFailure.updateMany({
      where: { id, schoolId, resolvedAt: null },
      data: { resolvedAt: now },
    });
    if (count === 0) throw rejected('NOT_FOUND');
    const failure = await this.deps.db.jobFailure.findUniqueOrThrow({ where: { id } });
    await this.deps.jobs.publish([retryJob(failure.queue as QueueName, failure.payload)]);
  }
}

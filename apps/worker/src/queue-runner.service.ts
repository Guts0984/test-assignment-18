import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { QUEUE_NAMES } from '@school/shared/jobs/registry';
import { type Job, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { DEPS, type WorkerDeps } from './deps';
import { runJob } from './processors/run-job';

/** Consumes every queue for as long as the application runs. */
@Injectable()
export class QueueRunnerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private workers: readonly Worker[] = [];

  constructor(@Inject(DEPS) private readonly deps: WorkerDeps) {}

  onApplicationBootstrap(): void {
    const { env, logger } = this.deps;
    // A consumer waits for Redis for as long as it takes.
    const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    connection.on('error', (error) => {
      logger.warn({ error: error.message }, 'redis connection error');
    });
    this.workers = QUEUE_NAMES.map((queue) => {
      const worker = new Worker(
        queue,
        (job: Job) =>
          runJob(this.deps, queue, {
            data: job.data as unknown,
            attemptsMade: job.attemptsMade,
            attempts: job.opts.attempts ?? 1,
          }),
        {
          connection,
          prefix: env.QUEUE_PREFIX,
          concurrency: env.WORKER_CONCURRENCY,
          lockDuration: env.JOB_LOCK_MS,
          stalledInterval: env.JOB_LOCK_MS,
          // A job interrupted by killed workers is taken over, not abandoned.
          maxStalledCount: 20,
        },
      );
      worker.on('error', (error) => {
        logger.warn({ queue, error: error.message }, 'queue error');
      });
      return worker;
    });
    logger.info({ queues: QUEUE_NAMES.length }, 'worker consuming');
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
  }
}

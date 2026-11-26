import { type Job } from '@school/shared/jobs/job';
import { QUEUE_NAMES, type QueueName } from '@school/shared/jobs/registry';
import { Queue } from 'bullmq';
import { connectionFor } from './connection';

export type QueueSettings = {
  readonly redisUrl: string;
  /** Namespace of the queue keys in Redis. */
  readonly prefix: string;
  readonly attempts: number;
  readonly backoffMs: number;
};

export type Publisher = {
  /** Best effort. Postgres records all pending work, and the worker sweeper recovers it. */
  readonly publish: (jobs: readonly Job[]) => Promise<void>;
  readonly queue: (name: QueueName) => Queue;
  readonly close: () => Promise<void>;
};

export const createPublisher = (
  settings: QueueSettings,
  onError: (message: string) => void,
): Publisher => {
  const connection = connectionFor(settings.redisUrl);
  connection.on('error', (error) => {
    onError(error.message);
  });
  const queues = new Map(
    QUEUE_NAMES.map((name) => {
      const queue = new Queue(name, { connection, prefix: settings.prefix });
      queue.on('error', (error) => {
        onError(error.message);
      });
      return [name, queue] as const;
    }),
  );
  const queueOf = (name: QueueName): Queue => {
    const queue = queues.get(name);
    if (!queue) throw new Error(`Unknown queue ${name}`);
    return queue;
  };
  const add = (job: Job) =>
    queueOf(job.queue).add(job.queue, job.payload, {
      jobId: job.id,
      delay: job.runAt ? Math.max(0, job.runAt.getTime() - Date.now()) : 0,
      attempts: settings.attempts,
      backoff: { type: 'exponential', delay: settings.backoffMs },
      // A finished id can be published again; final failures are kept in Postgres.
      removeOnComplete: true,
      removeOnFail: true,
    });

  return {
    publish: async (jobs) => {
      if (jobs.length === 0) return;
      if (connection.status !== 'ready') {
        onError('redis is not available; the sweeper will publish this work');
        return;
      }
      const results = await Promise.allSettled(jobs.map(add));
      for (const result of results) {
        if (result.status === 'rejected') onError(String(result.reason));
      }
    },
    queue: queueOf,
    close: async () => {
      // Closing a queue waits for Redis, so with Redis down only the socket is dropped.
      if (connection.status === 'ready') {
        await Promise.allSettled([...queues.values()].map((queue) => queue.close()));
      }
      connection.disconnect();
    },
  };
};

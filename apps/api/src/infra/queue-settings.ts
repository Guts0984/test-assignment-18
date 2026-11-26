import { type QueueSettings } from '@school/queue/publisher';
import { type Env } from '../config/env';

export const queueSettings = (env: Env): QueueSettings => ({
  redisUrl: env.REDIS_URL,
  prefix: env.QUEUE_PREFIX,
  attempts: env.JOB_ATTEMPTS,
  backoffMs: env.JOB_BACKOFF_MS,
});

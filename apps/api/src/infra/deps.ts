import { type Db } from '@school/db/client';
import { type TimeSource } from '@school/db/time';
import { type Publisher } from '@school/queue/publisher';
import { type Realtime } from '@school/queue/realtime';
import { type Redis } from 'ioredis';
import { type Env } from '../config/env';
import { type Logger } from './logger';

/** Everything with side effects, built once at the edge and injected. */
export type Deps = {
  readonly env: Env;
  readonly db: Db;
  readonly redis: Redis;
  /** Business time. Authentication uses the wall clock instead. */
  readonly time: TimeSource;
  readonly logger: Logger;
  readonly jobs: Publisher;
  readonly realtime: Realtime;
};

export const DEPS = Symbol('deps');

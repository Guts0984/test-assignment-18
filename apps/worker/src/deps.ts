import { type Db } from '@school/db/client';
import { type TimeSource } from '@school/db/time';
import { type Publisher } from '@school/queue/publisher';
import { type Realtime } from '@school/queue/realtime';
import { type Logger } from 'pino';
import { type Env } from './config/env';
import { type Mailer } from './mail/mailer';

export type WorkerDeps = {
  readonly env: Env;
  readonly db: Db;
  readonly time: TimeSource;
  readonly jobs: Publisher;
  readonly realtime: Realtime;
  readonly mailer: Mailer;
  readonly logger: Logger;
};

export const DEPS = Symbol('worker-deps');

import { z } from 'zod';

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');
const positive = z.coerce.number().int().min(1);

export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  QUEUE_PREFIX: z.string().min(1).default('school'),
  WORKER_CONCURRENCY: positive.default(8),
  SWEEP_INTERVAL_MS: positive.default(2_000),
  JOB_ATTEMPTS: positive.default(8),
  JOB_BACKOFF_MS: positive.default(2_000),
  /** How long a job may go without a heartbeat before another worker takes it over. */
  JOB_LOCK_MS: positive.default(30_000),
  EMAIL_LEASE_MS: positive.default(60_000),
  HOLD_TTL_SEC: positive.default(900),
  OFFER_TTL_SEC: positive.default(86_400),
  GATEWAY_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
    error: 'Expected 32 bytes in base64',
  }),
  WEBHOOK_CALLBACK_URL: z.url().default('http://nginx/api/payments/webhook'),
  PAYSTUB_HTTP_TIMEOUT_MS: positive.default(5_000),
  SMTP_HOST: z.string().min(1).default('mailpit'),
  SMTP_PORT: positive.default(1025),
  MAIL_FROM: z.email().default('school@example.test'),
  TEST_CLOCK_ENABLED: flag.default(false),
});

export type Env = Readonly<z.infer<typeof workerEnvSchema>>;

export const loadEnv = (
  source: Readonly<Record<string, string | undefined>> = process.env,
): Env => {
  const parsed = workerEnvSchema.safeParse(source);
  if (!parsed.success) {
    process.stderr.write(`Invalid environment:\n${z.prettifyError(parsed.error)}\n`);
    process.exit(1);
  }
  return Object.freeze(parsed.data);
};

import { isIP } from 'node:net';
import { z } from 'zod';

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');
const positive = z.coerce.number().int().min(1);

const list = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== ''),
);

const cidr = z.string().refine(
  (value) => {
    const [address = '', prefix = ''] = value.split('/');
    const family = isIP(address);
    return family !== 0 && /^\d+$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
  },
  { error: 'Expected CIDR notation, for example 10.0.0.0/8' },
);

export const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    API_PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    INSTANCE_ID: z.string().min(1).default('api'),
    PUBLIC_BASE_URL: z.url().default('http://localhost:8080'),
    CORS_ORIGINS: list.default(['http://localhost:8080']),
    TRUSTED_PROXY_CIDRS: list.pipe(z.array(cidr)).default(['172.16.0.0/12', '10.0.0.0/8']),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL_SEC: positive.default(900),
    REFRESH_TTL_SEC: positive.default(2_592_000),
    COOKIE_SECURE: flag.default(false),
    BODY_LIMIT_JSON_BYTES: positive.default(102_400),
    RATE_LIMIT_ENABLED: flag.default(true),
    RATE_LIMIT_LOGIN_IP_MAX: positive.default(20),
    RATE_LIMIT_LOGIN_IP_WINDOW_SEC: positive.default(60),
    RATE_LIMIT_LOGIN_ACCOUNT_MAX: positive.default(10),
    RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_SEC: positive.default(300),
    RATE_LIMIT_REGISTER_IP_MAX: positive.default(10),
    RATE_LIMIT_REGISTER_IP_WINDOW_SEC: positive.default(3600),
    RATE_LIMIT_FAIL_MODE: z.enum(['open', 'closed']).default('open'),
    HOLD_TTL_SEC: positive.default(900),
    OFFER_TTL_SEC: positive.default(86_400),
    GATEWAY_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
      error: 'Expected 32 bytes in base64',
    }),
    WEBHOOK_MAX_SKEW_SEC: positive.default(300),
    WEBHOOK_CALLBACK_URL: z.url().default('http://nginx/api/payments/webhook'),
    PAYSTUB_HTTP_TIMEOUT_MS: positive.default(5_000),
    QUEUE_PREFIX: z.string().min(1).default('school'),
    JOB_ATTEMPTS: positive.default(8),
    JOB_BACKOFF_MS: positive.default(2_000),
    TEST_CLOCK_ENABLED: flag.default(false),
    TEST_CONTROL_TOKEN: z.string().default(''),
  })
  .refine((env) => !env.TEST_CLOCK_ENABLED || env.TEST_CONTROL_TOKEN.length >= 16, {
    error: 'TEST_CONTROL_TOKEN (16+ characters) is required when the test clock is enabled',
    path: ['TEST_CONTROL_TOKEN'],
  });

export type Env = Readonly<z.infer<typeof apiEnvSchema>>;

export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Parses the environment, or prints what is wrong and exits. */
export const loadEnv = (source: EnvSource = process.env): Env => {
  const parsed = apiEnvSchema.safeParse(source);
  if (!parsed.success) {
    process.stderr.write(`Invalid environment:\n${z.prettifyError(parsed.error)}\n`);
    process.exit(1);
  }
  return Object.freeze(parsed.data);
};

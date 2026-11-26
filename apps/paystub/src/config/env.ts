import { z } from 'zod';

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');
const probability = z.coerce.number().min(0).max(1);
const positive = z.coerce.number().int().min(1);

export const paystubEnvSchema = z.object({
  PAYSTUB_PORT: z.coerce.number().int().min(0).max(65_535).default(4000),
  PAYSTUB_DATABASE_URL: z.url(),
  PAYSTUB_MERCHANT_KEY: z.string().min(16),
  PAYSTUB_PUBLIC_URL: z.url().default('http://localhost:8080/paystub'),
  PAYSTUB_CHAOS_MODE: flag.default(false),
  PAYSTUB_CHAOS_API_TARGETS: z
    .string()
    .default('http://api-1:3000,http://api-2:3000')
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  PAYSTUB_CHAOS_LATE_PROBABILITY: probability.default(0.2),
  PAYSTUB_CHAOS_LATE_DELAY_SEC: positive.default(1200),
  PAYSTUB_CHAOS_EARLY_REFUND_PROBABILITY: probability.default(0.5),
  PAYSTUB_CHAOS_REFUND_FAIL_EVERY: positive.default(5),
  PAYSTUB_RETRY_MAX: positive.default(10),
  PAYSTUB_RETRY_BASE_MS: positive.default(1_000),
  /** Enables the control routes used by tests. Empty disables them. */
  TEST_CONTROL_TOKEN: z.string().default(''),
});

export type StubEnv = Readonly<z.infer<typeof paystubEnvSchema>>;

export const loadEnv = (
  source: Readonly<Record<string, string | undefined>> = process.env,
): StubEnv => {
  const parsed = paystubEnvSchema.safeParse(source);
  if (!parsed.success) {
    process.stderr.write(`Invalid environment:\n${z.prettifyError(parsed.error)}\n`);
    process.exit(1);
  }
  return Object.freeze(parsed.data);
};

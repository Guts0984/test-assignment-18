import { z } from 'zod';

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

export const seedEnvSchema = z.object({
  DATABASE_URL: z.url(),
  SEED_ON_START: flag.default(true),
  SEED_SCALE: z.coerce.number().min(0.005).max(1).default(1),
  SEED_DEMO_PASSWORD: z.string().min(8).default('demo-password-2026'),
});

export const loadSeedEnv = (source: Readonly<Record<string, string | undefined>> = process.env) => {
  const parsed = seedEnvSchema.safeParse(source);
  if (!parsed.success) {
    process.stderr.write(`Invalid environment:\n${z.prettifyError(parsed.error)}\n`);
    process.exit(1);
  }
  return Object.freeze(parsed.data);
};

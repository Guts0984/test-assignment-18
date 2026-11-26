import { createDb } from '../src/client';
import { loadSeedEnv } from '../src/config/env';
import { seedDatabase } from './run';

const main = async (): Promise<void> => {
  const env = loadSeedEnv();
  if (!env.SEED_ON_START) return;
  const db = createDb(env.DATABASE_URL);
  const started = Date.now();
  try {
    const seeded = await seedDatabase(db, {
      scale: env.SEED_SCALE,
      password: env.SEED_DEMO_PASSWORD,
      now: new Date(),
      gateway: {
        baseUrl: env.PAYSTUB_INTERNAL_URL,
        key: env.PAYSTUB_MERCHANT_KEY,
        encryptionKey: env.GATEWAY_ENCRYPTION_KEY,
      },
    });
    const seconds = Math.round((Date.now() - started) / 1000);
    process.stdout.write(
      seeded ? `Seeded at scale ${env.SEED_SCALE} in ${seconds}s\n` : 'Already seeded\n',
    );
  } finally {
    await db.$disconnect();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${error instanceof Error ? (error.stack ?? '') : ''}\n`);
  process.exit(1);
});

import argon2 from 'argon2';
import { type Db, type Tx } from '../src/client';
import { seedCatalog, seedLessonWork } from './catalog';
import { seedEnrollments } from './enrollments';
import { seedHomework } from './homework';
import { seedPeople } from './people';
import { seedPromos } from './promos';
import { seedSizes } from './sizes';
import { seedSpecialCohorts } from './special';

const MARKER = 'base';
const LOCK_KEY = 7_340_001;
const HOUR = 3_600_000;

/**
 * Row-by-row guards that would make a bulk load take hours. They are disabled only inside the
 * seed transaction; the invariant checks verify the same facts over the finished data.
 */
const BULK_TABLES = ['enrollments', 'money_operations', 'ledger_entries', 'certificates'] as const;

const setBulkTriggers = async (tx: Tx, state: 'DISABLE' | 'ENABLE'): Promise<void> => {
  for (const table of BULK_TABLES) {
    await tx.$executeRawUnsafe(`ALTER TABLE ${table} ${state} TRIGGER USER`);
  }
  await tx.$executeRawUnsafe(`ALTER TABLE seat_journal ${state} TRIGGER seat_journal_occupancy`);
};

export type SeedOptions = {
  readonly scale: number;
  readonly password: string;
  readonly now: Date;
};

/** Fills an empty database. Returns false, changing nothing, if it was already seeded. */
export const seedDatabase = async (db: Db, options: SeedOptions): Promise<boolean> => {
  const sizes = seedSizes(options.scale);
  const passwordHash = await argon2.hash(options.password, { type: argon2.argon2id });
  const { now } = options;
  const seeded = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
      if (await tx.seedRun.findUnique({ where: { id: MARKER } })) return false;
      await tx.$executeRawUnsafe(`SET LOCAL work_mem = '128MB'`);
      await setBulkTriggers(tx, 'DISABLE');
      await seedPeople(tx, sizes, passwordHash, now);
      await seedCatalog(tx, sizes, now);
      await seedEnrollments(tx, sizes, now);
      // Deferred foreign key checks must run before triggers can be switched back on.
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      await setBulkTriggers(tx, 'ENABLE');
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
      await seedSpecialCohorts(tx, sizes, now);
      await seedLessonWork(tx, now);
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      await tx.$executeRawUnsafe(`ALTER TABLE certificates DISABLE TRIGGER USER`);
      await seedHomework(tx, sizes, now);
      await tx.$executeRawUnsafe(`ALTER TABLE certificates ENABLE TRIGGER USER`);
      await seedPromos(tx, now);
      await tx.seedRun.create({ data: { id: MARKER, completedAt: now } });
      return true;
    },
    { timeout: HOUR, maxWait: HOUR },
  );
  if (seeded) await db.$executeRawUnsafe('ANALYZE');
  return seeded;
};

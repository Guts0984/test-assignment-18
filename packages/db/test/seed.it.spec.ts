import { zonedInstant } from '@school/shared/schedule/zoned';
import { toZonedParts } from '@school/shared/schedule/display';
import { meetsHomeworkThreshold } from '@school/shared/certificate/eligibility';
import argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_LOGINS, seedId } from '../seed/ids';
import { seedDatabase } from '../seed/run';
import { seedSizes } from '../seed/sizes';
import { assertInvariants } from '../src/invariants/assert';
import { createTestDatabase, type TestDatabase } from '../src/testing/database';

const SCALE = 0.01;
const NOW = new Date('2026-03-10T12:00:00Z');
const sizes = seedSizes(SCALE);
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase(process.env['DATABASE_URL'] ?? '');
  await seedDatabase(database.db, { scale: SCALE, password: 'demo-password-2026', now: NOW });
}, 300_000);
afterAll(async () => {
  await database.drop();
});

const count = async (query: string): Promise<number> => {
  const rows = await database.db.$queryRawUnsafe<{ n: bigint }[]>(query);
  return Number(rows[0]?.n ?? 0);
};

describe('seed', () => {
  it('describes the full data set at scale 1', () => {
    expect(seedSizes(1)).toMatchObject({
      students: 300_000,
      courses: 200,
      cohorts: 2_000,
      submissions: 1_000_000,
      certificates: 100_000,
    });
    const full = seedSizes(1);
    expect(full.bulkCohorts * full.enrollmentsPerCohort).toBeGreaterThanOrEqual(500_000);
  });

  it('leaves a database that satisfies every invariant', async () => {
    await assertInvariants(database.db);
  });

  it('creates the requested volumes', async () => {
    expect(await count(`SELECT count(*) AS n FROM users WHERE role = 'student'`)).toBe(
      sizes.students,
    );
    expect(await count('SELECT count(*) AS n FROM courses')).toBe(sizes.courses);
    expect(await count('SELECT count(*) AS n FROM cohorts')).toBe(sizes.cohorts);
    expect(await count('SELECT count(*) AS n FROM enrollments')).toBeGreaterThanOrEqual(
      500_000 * SCALE,
    );
    expect(await count('SELECT count(*) AS n FROM submissions')).toBe(sizes.submissions);
    expect(await count('SELECT count(*) AS n FROM certificates')).toBe(sizes.certificates);
  });

  it('covers three zones, three currencies and two years back to six months ahead', async () => {
    expect(await count('SELECT count(DISTINCT time_zone) AS n FROM cohorts')).toBe(3);
    expect(await count('SELECT count(DISTINCT currency) AS n FROM cohorts')).toBe(3);
    const [range] = await database.db.$queryRaw<{ first: Date; last: Date }[]>`
      SELECT min(start_date) AS first, max(start_date) AS last FROM cohorts`;
    expect(range && range.first < new Date('2024-05-01')).toBe(true);
    expect(range && range.last > new Date('2026-08-01')).toBe(true);
  });

  it('has every enrollment and homework status', async () => {
    const statuses = await database.db.$queryRaw<{ status: string }[]>`
      SELECT DISTINCT status FROM enrollments`;
    expect(statuses.map((row) => row.status).sort()).toEqual(
      ['cancelled', 'completed', 'expired', 'paid', 'refunded', 'transferred'].sort(),
    );
    expect(await count('SELECT count(DISTINCT status) AS n FROM submissions')).toBe(4);
    expect(await count('SELECT count(*) AS n FROM submissions WHERE is_late')).toBeGreaterThan(0);
  });

  it('gives certificates only to those who earned them, and to nobody else eligible', async () => {
    const rows = await database.db.$queryRaw<
      { certified: boolean; accepted: bigint; total: bigint }[]
    >`
      SELECT (cert.id IS NOT NULL) AS certified,
             count(s.id) FILTER (WHERE s.status = 'accepted') AS accepted,
             count(h.id) AS total
        FROM enrollments e
        JOIN homeworks h ON h.cohort_id = e.cohort_id
        LEFT JOIN submissions s ON s.homework_id = h.id AND s.enrollment_id = e.id
        LEFT JOIN certificates cert ON cert.enrollment_id = e.id
       WHERE e.status = 'completed'
       GROUP BY e.id, cert.id`;
    const wrong = rows.filter(
      (row) => row.certified !== meetsHomeworkThreshold(Number(row.accepted), Number(row.total)),
    );
    expect(wrong).toEqual([]);
  });

  it('leaves no finished cohort for a worker to complete', async () => {
    expect(
      await count(`SELECT count(*) AS n FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
        WHERE e.status = 'paid' AND c.ends_at <= '${NOW.toISOString()}'`),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*) AS n FROM scheduled_notifications WHERE due_at <= '${NOW.toISOString()}'`,
      ),
    ).toBe(0);
  });

  it('computes lesson times and deadlines exactly as the shared rules do', async () => {
    const lessons = await database.db.lesson.findMany({
      take: 400,
      orderBy: { id: 'asc' },
      include: { cohort: true, homework: true },
    });
    for (const lesson of lessons) {
      const date = lesson.localDate.toISOString().slice(0, 10);
      expect(lesson.startsAt).toEqual(zonedInstant(date, lesson.localTime, lesson.cohort.timeZone));
      const deadline = toZonedParts(
        lesson.homework?.deadlineAt ?? new Date(0),
        lesson.cohort.timeZone,
      );
      expect(deadline.time).toBe('23:59');
    }
  });

  it('starts several cohorts soon with last seats, some full with a waitlist', async () => {
    const soon = await database.db.$queryRaw<{ free: number; waiting: bigint }[]>`
      SELECT c.capacity - c.seats_taken AS free,
             (SELECT count(*) FROM waitlist_entries w
               WHERE w.cohort_id = c.id AND w.status = 'waiting') AS waiting
        FROM cohorts c
       WHERE c.starts_at > ${NOW} AND c.starts_at < ${new Date('2026-03-20T00:00:00Z')}`;
    expect(soon.filter((c) => c.free > 0 && c.free <= 2).length).toBeGreaterThanOrEqual(3);
    expect(soon.filter((c) => c.free === 0 && c.waiting > 0n).length).toBeGreaterThanOrEqual(3);
  });

  it('has cohorts whose lessons cross a daylight saving change at a constant local time', async () => {
    const lessons = await database.db.lesson.findMany({
      where: { startsAt: { gt: NOW } },
      include: { cohort: true },
    });
    const byCohort = Map.groupBy(lessons, (lesson) => lesson.cohortId);
    const crossingZones = new Set(
      [...byCohort.values()]
        .filter(
          (items) =>
            new Set(items.map((l) => toZonedParts(l.startsAt, l.cohort.timeZone).offset)).size > 1,
        )
        .map((items) => items[0]?.cohort.timeZone),
    );
    expect(crossingZones.size).toBe(3);
  });

  it('creates demo accounts that can be verified with the demo password', async () => {
    for (const email of [
      DEMO_LOGINS.admin(1),
      DEMO_LOGINS.manager(2),
      DEMO_LOGINS.mentor(3, 1),
      DEMO_LOGINS.student(1),
    ]) {
      const user = await database.db.user.findUniqueOrThrow({ where: { email } });
      expect(await argon2.verify(user.passwordHash, 'demo-password-2026')).toBe(true);
    }
  });

  it('gives every row an id the API accepts', async () => {
    const wellFormed = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    for (const table of [
      'schools',
      'users',
      'courses',
      'cohorts',
      'lessons',
      'homeworks',
      'enrollments',
      'submissions',
      'certificates',
    ]) {
      expect([
        table,
        await count(`SELECT count(*) AS n FROM ${table} WHERE id::text !~ '${wellFormed}'`),
      ]).toEqual([table, 0]);
    }
    expect(seedId('school-1')).toBe(
      (
        await database.db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM schools WHERE id = '${seedId('school-1')}'`,
        )
      )[0]?.id,
    );
  });

  it('does nothing the second time', async () => {
    const before = await count('SELECT count(*) AS n FROM enrollments');
    const again = await seedDatabase(database.db, {
      scale: SCALE,
      password: 'demo-password-2026',
      now: NOW,
    });
    expect(again).toBe(false);
    expect(await count('SELECT count(*) AS n FROM enrollments')).toBe(before);
  });

  it('leaves the guards switched on', async () => {
    expect(
      await count(
        `SELECT count(*) AS n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'D'`,
      ),
    ).toBe(0);
  });
});

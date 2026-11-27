import { assertInvariants } from '@school/db/invariants/assert';
import { toZonedParts } from '@school/shared/schedule/display';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOW, startApi, type TestApi } from './attacker/app';
import { client } from './attacker/client';
import { expectError } from './attacker/expect';
import { staffedSchool } from './attacker/people';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.stop();
});

type Detail = {
  id: string;
  capacity: number;
  seatsTaken: number;
  startsAt: string;
  startDate: string;
  lessons: { id: string; seq: number; startsAt: string; localDate: string; localTime: string }[];
};

/** «по вторникам и четвергам в 19:00 по Киеву, 12 занятий», from 23 March 2026. */
const createKyivCohort = async () => {
  const staff = await staffedSchool(api);
  const course = await staff.manager.http.post('/api/manager/courses', {
    title: `Kyiv ${staff.school.id}`,
    direction: 'programming',
  });
  const reply = await staff.manager.http.post('/api/manager/cohorts', {
    courseId: (course.body as { id: string }).id,
    mentorId: staff.mentor.user.id,
    startDate: '2026-03-23',
    timeZone: 'Europe/Kyiv',
    capacity: 12,
    priceMinor: 500_000,
    currency: 'UAH',
    schedule: { weekdays: [2, 4], localTime: '19:00', count: 12 },
  });
  expect(reply.status).toBe(201);
  return { staff, cohort: reply.body as Detail };
};

describe('cohort schedule', () => {
  it('creates lessons at 19:00 Kyiv across the daylight saving change, with homework and reminders', async () => {
    const { cohort } = await createKyivCohort();
    expect(cohort).toMatchObject({ capacity: 12, seatsTaken: 0, startDate: '2026-03-24' });
    expect(cohort.lessons).toHaveLength(12);
    expect(
      cohort.lessons.map((l) => toZonedParts(new Date(l.startsAt), 'Europe/Kyiv').time),
    ).toEqual(Array(12).fill('19:00'));
    expect(cohort.lessons[1]?.startsAt).toBe('2026-03-26T17:00:00.000Z');
    expect(cohort.lessons[2]?.startsAt).toBe('2026-03-31T16:00:00.000Z');

    const lessonIds = cohort.lessons.map((lesson) => lesson.id);
    const homework = await api.db.homework.findMany({ where: { cohortId: cohort.id } });
    expect(homework).toHaveLength(12);
    expect(
      await api.db.scheduledNotification.count({
        where: { lessonId: { in: lessonIds }, status: 'pending' },
      }),
    ).toBe(36);
    await assertInvariants(api.db);
  });

  it('moves one lesson: new version, old reminders cancelled, new ones and a new deadline', async () => {
    const { staff, cohort } = await createKyivCohort();
    const lesson = cohort.lessons[0];
    if (!lesson) throw new Error('fixture');
    const reply = await staff.manager.http.patch(`/api/manager/lessons/${lesson.id}`, {
      localDate: '2026-03-30',
      localTime: '10:30',
    });
    expect(reply.status).toBe(200);
    const moved = reply.body as Detail;
    // The moved lesson is now second; the cohort starts with the Thursday one.
    expect(moved.startsAt).toBe('2026-03-26T17:00:00.000Z');
    expect(moved.lessons[1]).toMatchObject({ id: lesson.id, localTime: '10:30' });

    const reminders = await api.db.scheduledNotification.findMany({
      where: { lessonId: lesson.id },
      orderBy: [{ lessonVersion: 'asc' }, { dueAt: 'asc' }],
    });
    expect(
      reminders.map((r) => [r.lessonVersion, r.kind, r.status, r.dueAt.toISOString()]),
    ).toEqual([
      [1, 'lesson_24h', 'cancelled', '2026-03-23T17:00:00.000Z'],
      [1, 'lesson_1h', 'cancelled', '2026-03-24T16:00:00.000Z'],
      [1, 'deadline_24h', 'cancelled', '2026-03-30T20:59:59.999Z'],
      [2, 'lesson_24h', 'pending', '2026-03-29T07:30:00.000Z'],
      [2, 'lesson_1h', 'pending', '2026-03-30T06:30:00.000Z'],
      [2, 'deadline_24h', 'pending', '2026-04-05T20:59:59.999Z'],
    ]);
    const homework = await api.db.homework.findUniqueOrThrow({ where: { lessonId: lesson.id } });
    expect(homework.deadlineAt.toISOString()).toBe('2026-04-06T20:59:59.999Z');
  });

  it('survives ten simultaneous moves of one lesson with one live set of reminders', async () => {
    const { staff, cohort } = await createKyivCohort();
    const lesson = cohort.lessons[3];
    if (!lesson) throw new Error('fixture');
    const replies = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        staff.manager.http.patch(`/api/manager/lessons/${lesson.id}`, {
          localDate: '2026-05-12',
          localTime: `1${i}:00`,
        }),
      ),
    );
    expect(new Set(replies.map((reply) => reply.status))).toEqual(new Set([200]));
    const stored = await api.db.lesson.findUniqueOrThrow({ where: { id: lesson.id } });
    expect(stored.version).toBe(11);
    const pending = await api.db.scheduledNotification.findMany({
      where: { lessonId: lesson.id, status: 'pending' },
    });
    expect(pending.map((r) => r.lessonVersion)).toEqual([11, 11, 11]);
  });

  it('refuses to move a started lesson or to move one into the past', async () => {
    const { staff, cohort } = await createKyivCohort();
    const [first, second] = cohort.lessons;
    if (!first || !second) throw new Error('fixture');
    const move = (id: string, localDate: string) =>
      staff.manager.http.patch(`/api/manager/lessons/${id}`, { localDate, localTime: '19:00' });
    expectError(await move(second.id, '2026-02-01'), 'VALIDATION_FAILED');
    api.clock.set(new Date(first.startsAt));
    expectError(await move(first.id, '2026-06-01'), 'INVALID_TRANSITION');
    api.clock.set(NOW);
  });

  it('shows open cohorts in the catalog until they start', async () => {
    const { cohort } = await createKyivCohort();
    const search = () =>
      client(api.url).get(
        `/api/catalog/cohorts?q=${encodeURIComponent('kyiv')}&startFrom=2026-03-01&currency=UAH&priceMax=500000&pageSize=100`,
      );
    const open = (await search()).body as { items: { cohortId: string; freeSeats: number }[] };
    expect(open.items.find((item) => item.cohortId === cohort.id)).toMatchObject({
      freeSeats: 12,
    });
    api.clock.set(new Date(cohort.startsAt));
    const started = (await search()).body as { items: { cohortId: string }[] };
    expect(started.items.some((item) => item.cohortId === cohort.id)).toBe(false);
    api.clock.set(NOW);
  });
});

describe('staff management', () => {
  it('creates staff who can sign in, and protects mentors with open cohorts', async () => {
    const { staff } = await createKyivCohort();
    const created = await staff.admin.http.post('/api/admin/staff', {
      email: 'Second.Mentor@example.test',
      password: 'a-new-mentor-password',
      fullName: 'Second Mentor',
      role: 'mentor',
    });
    expect(created.body).toMatchObject({ email: 'second.mentor@example.test', role: 'mentor' });
    expect(created.text).not.toContain('password');
    const login = await client(api.url).post('/api/auth/login', {
      email: 'second.mentor@example.test',
      password: 'a-new-mentor-password',
    });
    expect(login.status).toBe(200);
    expectError(
      await staff.admin.http.post('/api/admin/staff', {
        email: 'second.mentor@example.test',
        password: 'a-new-mentor-password',
        fullName: 'Duplicate',
        role: 'mentor',
      }),
      'EMAIL_TAKEN',
    );
    const listed = (await staff.admin.http.get('/api/admin/staff')).body as {
      items: { id: string; openCohorts: number }[];
    };
    const openOf = (id: string) => listed.items.find((item) => item.id === id)?.openCohorts;
    // The page uses this to explain, before any click, why the buttons are unavailable.
    expect(openOf(staff.mentor.user.id)).toBe(1);
    expect(openOf(staff.manager.user.id)).toBe(0);
    const busy = `/api/admin/staff/${staff.mentor.user.id}`;
    expectError(await staff.admin.http.patch(busy, { disabled: true }), 'CONFLICT');
    expectError(await staff.admin.http.patch(busy, { role: 'manager' }), 'CONFLICT');
    expectError(
      await staff.admin.http.patch(`/api/admin/staff/${staff.admin.user.id}`, { disabled: true }),
      'FORBIDDEN',
    );
  });
});

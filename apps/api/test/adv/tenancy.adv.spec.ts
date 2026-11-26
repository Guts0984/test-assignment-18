import { createCohort } from '@school/db/testing/factories';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from '../attacker/app';
import { expectError } from '../attacker/expect';
import { signedIn, staffedSchool } from '../attacker/people';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.stop();
});

describe('another school', () => {
  it('is invisible to a manager and cannot be changed', async () => {
    const target = await createCohort(api.db, { capacity: 3 });
    const lesson = await api.db.lesson.create({
      data: {
        cohortId: target.cohort.id,
        seq: 1,
        localDate: new Date('2026-04-07'),
        localTime: '19:00',
        startsAt: new Date('2026-04-07T16:00:00Z'),
        endsAt: new Date('2026-04-07T17:30:00Z'),
      },
    });
    const intruder = (await staffedSchool(api)).manager.http;
    const { cohort, course, mentor } = target;

    expectError(await intruder.get(`/api/manager/cohorts/${cohort.id}`), 'NOT_FOUND');
    expectError(
      await intruder.patch(`/api/manager/cohorts/${cohort.id}`, { priceMinor: 1 }),
      'NOT_FOUND',
    );
    expectError(
      await intruder.patch(`/api/manager/courses/${course.id}`, { title: 'Taken over' }),
      'NOT_FOUND',
    );
    expectError(
      await intruder.patch(`/api/manager/lessons/${lesson.id}`, {
        localDate: '2026-05-05',
        localTime: '10:00',
      }),
      'NOT_FOUND',
    );
    const list = await intruder.get('/api/manager/cohorts?pageSize=100');
    expect(list.text).not.toContain(cohort.id);
    expect((await intruder.get('/api/manager/courses')).text).not.toContain(course.id);
    expect((await intruder.get('/api/manager/mentors')).text).not.toContain(mentor.id);

    const stored = await api.db.lesson.findUniqueOrThrow({ where: { id: lesson.id } });
    expect([stored.version, stored.localTime]).toEqual([1, '19:00']);
    expect((await api.db.course.findUniqueOrThrow({ where: { id: course.id } })).title).toBe(
      'TypeScript',
    );
  });

  it('cannot lend its course or mentor to a new cohort', async () => {
    const target = await createCohort(api.db);
    const mine = await staffedSchool(api);
    const ownCourse = await api.db.course.create({
      data: { schoolId: mine.school.id, title: 'Own', direction: 'data' },
    });
    const body = {
      courseId: ownCourse.id,
      mentorId: mine.mentor.user.id,
      startDate: '2026-04-06',
      timeZone: 'Europe/Kyiv',
      capacity: 5,
      priceMinor: 100,
      currency: 'UAH',
      schedule: { weekdays: [1], localTime: '10:00', count: 2 },
    };
    expectError(
      await mine.manager.http.post('/api/manager/cohorts', {
        ...body,
        courseId: target.course.id,
      }),
      'NOT_FOUND',
    );
    for (const mentorId of [target.mentor.id, mine.manager.user.id]) {
      expectError(
        await mine.manager.http.post('/api/manager/cohorts', { ...body, mentorId }),
        'VALIDATION_FAILED',
      );
    }
    expect(await api.db.cohort.count({ where: { schoolId: mine.school.id } })).toBe(0);
  });

  it('keeps its staff away from a foreign administrator', async () => {
    const theirs = await staffedSchool(api);
    const mine = await staffedSchool(api);
    expectError(
      await mine.admin.http.patch(`/api/admin/staff/${theirs.mentor.user.id}`, { disabled: true }),
      'NOT_FOUND',
    );
    expect((await mine.admin.http.get('/api/admin/staff')).text).not.toContain(
      theirs.mentor.user.email,
    );
    expect((await theirs.mentor.http.get('/api/auth/me')).status).toBe(200);
  });

  it('never exposes a student record through staff management', async () => {
    const { admin } = await staffedSchool(api);
    const student = await signedIn(api, 'student');
    expectError(
      await admin.http.patch(`/api/admin/staff/${student.user.id}`, { role: 'manager' }),
      'NOT_FOUND',
    );
  });
});

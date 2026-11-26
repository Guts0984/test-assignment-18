import { createCohort } from '@school/db/testing/factories';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from '../attacker/app';
import { client } from '../attacker/client';
import { expectError } from '../attacker/expect';
import { signedIn, staffedSchool } from '../attacker/people';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.stop();
});

describe('mass assignment', () => {
  it('cannot register as staff or into a school', async () => {
    const { school } = await staffedSchool(api);
    for (const extra of [
      { role: 'admin' },
      { schoolId: school.id },
      { passwordHash: 'x' },
      { disabledAt: null },
    ]) {
      const reply = await client(api.url).post('/api/auth/register', {
        email: 'grab@example.test',
        password: 'long-enough-password',
        fullName: 'Mallory',
        timeZone: 'Europe/Kyiv',
        ...extra,
      });
      expectError(reply, 'VALIDATION_FAILED');
    }
    expect(await api.db.user.count({ where: { email: 'grab@example.test' } })).toBe(0);
  });

  it('cannot promote oneself through the profile', async () => {
    const { http, user } = await signedIn(api, 'student');
    expectError(
      await http.patch('/api/auth/me', { timeZone: 'Europe/Kyiv', role: 'admin' }),
      'VALIDATION_FAILED',
    );
    expect((await api.db.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('student');
  });

  it('cannot create an administrator or move staff to another school', async () => {
    const { admin, school, mentor } = await staffedSchool(api);
    const other = await staffedSchool(api);
    const base = { email: 'new@example.test', password: 'long-enough-password', fullName: 'New' };
    for (const body of [
      { ...base, role: 'admin' },
      { ...base, role: 'mentor', schoolId: other.school.id },
    ]) {
      expectError(await admin.http.post('/api/admin/staff', body), 'VALIDATION_FAILED');
    }
    expectError(
      await admin.http.patch(`/api/admin/staff/${mentor.user.id}`, {
        fullName: 'Moved',
        schoolId: other.school.id,
      }),
      'VALIDATION_FAILED',
    );
    expect(await api.db.user.count({ where: { schoolId: school.id } })).toBe(3);
  });

  it('cannot set seat counters, owners or another school on a cohort', async () => {
    const mine = await staffedSchool(api);
    const { cohort, school } = await createCohort(api.db, { capacity: 5 });
    const manager = await signedIn(api, 'manager', school.id);
    for (const body of [
      { priceMinor: 1, seatsTaken: 0 },
      { priceMinor: 1, capacity: 500 },
      { priceMinor: 1, schoolId: mine.school.id },
    ]) {
      expectError(
        await manager.http.patch(`/api/manager/cohorts/${cohort.id}`, body),
        'VALIDATION_FAILED',
      );
    }
    const stored = await api.db.cohort.findUniqueOrThrow({ where: { id: cohort.id } });
    expect([stored.priceMinor, stored.capacity, stored.schoolId]).toEqual([10_000, 5, school.id]);
  });
});

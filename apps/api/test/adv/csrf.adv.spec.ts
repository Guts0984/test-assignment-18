import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from '../attacker/app';
import { expectError } from '../attacker/expect';
import { staffedSchool } from '../attacker/people';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.stop();
});

const course = { title: 'Forged course', direction: 'programming' };

describe('cross-site requests', () => {
  it.each([
    { origin: 'https://evil.example' },
    { origin: 'null' },
    { origin: 'http://localhost:8080.evil.example' },
    { 'sec-fetch-site': 'cross-site' },
  ])('are refused with %o even with a valid session', async (headers) => {
    const { manager, school } = await staffedSchool(api);
    expectError(
      await manager.http.post('/api/manager/courses', course, {
        headers: headers as unknown as Record<string, string>,
      }),
      'CSRF_REJECTED',
    );
    expect(await api.db.course.count({ where: { schoolId: school.id } })).toBe(0);
  });

  it('are accepted from the allowed origin', async () => {
    const { manager } = await staffedSchool(api);
    const reply = await manager.http.post('/api/manager/courses', course, {
      headers: { origin: 'http://localhost:8080' },
    });
    expect(reply.status).toBe(201);
  });

  it('cannot be smuggled as a form post', async () => {
    const { manager, school } = await staffedSchool(api);
    expectError(
      await manager.http.send('POST', '/api/manager/courses', {
        raw: 'title=Forged&direction=programming',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
      'UNSUPPORTED_MEDIA_TYPE',
    );
    expect(await api.db.course.count({ where: { schoolId: school.id } })).toBe(0);
  });

  it('get no CORS grant for a foreign origin', async () => {
    const { manager } = await staffedSchool(api);
    const reply = await manager.http.get('/api/auth/me', {
      headers: { origin: 'https://evil.example' },
    });
    expect(reply.headers['access-control-allow-origin']).toBeUndefined();
  });
});

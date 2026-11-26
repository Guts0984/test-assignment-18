import { createCohort } from '@school/db/testing/factories';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from '../attacker/app';
import { client } from '../attacker/client';
import { expectError } from '../attacker/expect';
import { staffedSchool } from '../attacker/people';

let api: TestApi;
let staff: Awaited<ReturnType<typeof staffedSchool>>;
let courseId: string;

beforeAll(async () => {
  api = await startApi();
  staff = await staffedSchool(api);
  const course = await api.db.course.create({
    data: { schoolId: staff.school.id, title: 'Input', direction: 'programming' },
  });
  courseId = course.id;
});
afterAll(async () => {
  await api.stop();
});

const cohort = () => ({
  courseId,
  mentorId: staff.mentor.user.id,
  startDate: '2026-04-06',
  timeZone: 'Europe/Kyiv',
  capacity: 10,
  priceMinor: 1_000,
  currency: 'UAH',
  schedule: { weekdays: [2, 4], localTime: '19:00', count: 4 },
});

describe('catalog query', () => {
  it.each([
    'page=0',
    'page=-1',
    'page=1.5',
    'page=99999999999999999999',
    'pageSize=0',
    'pageSize=101',
    'priceMin=-1&currency=UAH',
    'priceMin=10.5&currency=UAH',
    'priceMin=10',
    'currency=BTC',
    'startFrom=yesterday',
    'startFrom=0000-01-01',
    'startTo=2026-13-01',
    'q=a&q=b',
    `q=${'x'.repeat(101)}`,
    'unknown=1',
  ])('rejects %s', async (query) => {
    expectError(await client(api.url).get(`/api/catalog/cohorts?${query}`), 'VALIDATION_FAILED');
  });

  it.each(["'; DROP TABLE cohorts; --", "%' OR '1'='1", '\\', '%_%', '🎓'.repeat(20)])(
    'treats the search text %s as plain text',
    async (q) => {
      await createCohort(api.db);
      const reply = await client(api.url).get(
        `/api/catalog/cohorts?q=${encodeURIComponent(q)}&direction=${encodeURIComponent(q)}`,
      );
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({ total: 0 });
      expect(await api.db.cohort.count()).toBeGreaterThan(0);
    },
  );

  it('rejects an encoded NUL', async () => {
    expectError(await client(api.url).get('/api/catalog/cohorts?q=%00'), 'MALFORMED_REQUEST');
  });
});

describe('request bodies', () => {
  it.each([
    ['capacity', 0],
    ['capacity', -3],
    ['capacity', 2.5],
    ['capacity', 1_000_000],
    ['priceMinor', 99.99],
    ['priceMinor', -1],
    ['priceMinor', '1000'],
    ['priceMinor', 1e21],
    ['currency', 'uah'],
    ['startDate', '2026-02-30'],
    ['startDate', '2020-01-01'],
    ['timeZone', 'Europe/Atlantis'],
    ['courseId', '1 OR 1=1'],
    ['mentorId', null],
    ['lessonMinutes', 0],
    ['schedule', { weekdays: [8], localTime: '19:00', count: 4 }],
    ['schedule', { weekdays: [2], localTime: '25:00', count: 4 }],
    ['schedule', { weekdays: [2], localTime: '19:00', count: 1_000_000 }],
  ])('rejects a cohort whose %s is %j', async (field, value) => {
    const reply = await staff.manager.http.post('/api/manager/cohorts', {
      ...cohort(),
      [field]: value,
    });
    expectError(reply, 'VALIDATION_FAILED');
    expect((reply.body as { fields: { path: string }[] }).fields[0]?.path).toContain(field);
    expect(await api.db.cohort.count({ where: { courseId } })).toBe(0);
  });

  it.each([
    ['broken JSON', '{"title": "a",'],
    ['a bare string', '"title"'],
    ['a prototype key', '{"__proto__": {"role": "admin"}, "title": "ab", "direction": "cd"}'],
    ['a nested prototype key', '{"title": "ab", "direction": {"__proto__": 1}}'],
    ['a NUL character', '{"title": "a\\u0000b", "direction": "cd"}'],
  ])('rejects %s as malformed', async (_name, raw) => {
    expectError(
      await staff.manager.http.send('POST', '/api/manager/courses', { raw }),
      'MALFORMED_REQUEST',
    );
  });

  it.each([[null], [[]], [{}]])('rejects the body %j with field errors', async (body) => {
    expectError(
      await staff.manager.http.send('POST', '/api/manager/courses', { raw: JSON.stringify(body) }),
      body === null ? 'MALFORMED_REQUEST' : 'VALIDATION_FAILED',
    );
  });

  it('refuses an oversized body', async () => {
    const reply = await staff.manager.http.post('/api/manager/courses', {
      title: 'x'.repeat(200_000),
      direction: 'programming',
    });
    expectError(reply, 'PAYLOAD_TOO_LARGE');
  });

  it('refuses another content type', async () => {
    const reply = await staff.manager.http.send('POST', '/api/manager/courses', {
      raw: '<course/>',
      headers: { 'content-type': 'application/xml' },
    });
    expectError(reply, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('answers unknown routes and malformed ids in the same format', async () => {
    expectError(await client(api.url).get('/api/nothing-here'), 'NOT_FOUND');
    expectError(await client(api.url).get('/api/catalog/courses/abc'), 'VALIDATION_FAILED');
    expectError(
      await client(api.url).get('/api/catalog/courses/018f6f1e-7b1a-7c3e-9d6a-111111111111'),
      'NOT_FOUND',
    );
  });
});

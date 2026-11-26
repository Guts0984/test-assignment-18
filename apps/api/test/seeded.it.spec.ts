import { DEMO_LOGINS } from '@school/db/seed/ids';
import { seedDatabase } from '@school/db/seed/run';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOW, startApi, type TestApi } from './attacker/app';
import { client, type Client } from './attacker/client';

const PASSWORD = 'demo-password-2026';
let api: TestApi;

beforeAll(async () => {
  api = await startApi();
  await seedDatabase(api.db, { scale: 0.01, password: PASSWORD, now: NOW });
}, 300_000);
afterAll(async () => {
  await api.stop();
});

const signIn = async (email: string): Promise<Client> => {
  const http = client(api.url);
  const reply = await http.post('/api/auth/login', { email, password: PASSWORD });
  expect([email, reply.status]).toEqual([email, 200]);
  return http;
};

type Items = { items: Record<string, string>[] };

/** Every response is checked against its schema, so seeded rows must satisfy the contract. */
const read = async (http: Client, path: string): Promise<unknown> => {
  const reply = await http.get(path);
  expect([path, reply.status]).toEqual([path, 200]);
  return reply.body;
};

describe('the seeded database through the api', () => {
  it('serves the catalog and a course, and books a seeded cohort', async () => {
    const visitor = client(api.url);
    const found = (await read(visitor, '/api/catalog/cohorts?pageSize=100')) as Items;
    expect(found.items.length).toBeGreaterThan(0);
    await read(visitor, '/api/catalog/directions');
    await read(visitor, `/api/catalog/courses/${found.items[0]?.['courseId'] ?? ''}`);
    const student = await signIn(DEMO_LOGINS.student(2_900));
    const open = found.items.find((item) => Number(item['freeSeats']) > 0);
    const held = await student.post('/api/enrollments', { cohortId: open?.['cohortId'] });
    expect(held.status).toBe(201);
  });

  it('serves a student’s pages', async () => {
    const student = await signIn(DEMO_LOGINS.student(1));
    for (const path of ['cabinet', 'enrollments', 'waitlist', 'certificates']) {
      await read(student, `/api/${path}`);
    }
    const certified = await api.db.certificate.findFirstOrThrow({ include: { enrollment: true } });
    const owner = await api.db.user.findUniqueOrThrow({ where: { id: certified.studentId } });
    const holder = await signIn(owner.email);
    await read(holder, '/api/cabinet');
    await read(holder, '/api/certificates');
    await read(client(api.url), `/api/verify/${certified.verifyToken}`);
    await read(holder, `/api/enrollments/${certified.enrollmentId}`);
  });

  it('serves a mentor’s pages', async () => {
    const mentor = await signIn(DEMO_LOGINS.mentor(1, 1));
    const queue = (await read(mentor, '/api/mentor/queue')) as Items;
    await read(mentor, '/api/mentor/reviews');
    await read(mentor, '/api/mentor/students');
    expect(queue.items.length).toBeGreaterThan(0);
    await read(mentor, `/api/mentor/submissions/${queue.items[0]?.['submissionId'] ?? ''}`);
  });

  it('serves a manager’s and an administrator’s pages', async () => {
    const manager = await signIn(DEMO_LOGINS.manager(1));
    await read(manager, '/api/manager/courses');
    await read(manager, '/api/manager/mentors');
    const cohorts = (await read(manager, '/api/manager/cohorts?pageSize=100')) as Items;
    const id = cohorts.items[0]?.['id'] ?? '';
    for (const tail of ['', '/students', '/waitlist', '/payments']) {
      await read(manager, `/api/manager/cohorts/${id}${tail}`);
    }
    await read(manager, '/api/manager/students?q=olena');
    await read(manager, '/api/manager/promos');
    await read(manager, '/api/manager/report?from=2025-03-01&to=2026-03-01');
    await read(manager, '/api/manager/failed-jobs');
    const admin = await signIn(DEMO_LOGINS.admin(1));
    await read(admin, '/api/admin/staff');
    await read(admin, '/api/admin/gateway');
  });
});

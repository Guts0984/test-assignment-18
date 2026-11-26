import { ROLES, type Role } from '@school/shared/status/actors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from '../attacker/app';
import { client, type Client } from '../attacker/client';
import { expectError } from '../attacker/expect';
import { signedIn, staffedSchool } from '../attacker/people';

/**
 * Who may call each route. A route missing here fails the sweep, so a new endpoint cannot ship
 * without stating its audience.
 */
const ACCESS: Record<string, readonly Role[] | 'public'> = {
  'GET /api/health': 'public',
  'POST /api/auth/register': 'public',
  'POST /api/auth/login': 'public',
  'POST /api/auth/refresh': 'public',
  'POST /api/auth/logout': 'public',
  'GET /api/auth/me': ROLES,
  'PATCH /api/auth/me': ROLES,
  'GET /api/catalog/cohorts': 'public',
  'GET /api/catalog/directions': 'public',
  'GET /api/catalog/courses/:id': 'public',
  'PUT /api/homework/:id/submission': ['student'],
  'GET /api/submissions/:id/file': ['student', 'mentor', 'manager'],
  'GET /api/mentor/queue': ['mentor'],
  'GET /api/mentor/reviews': ['mentor'],
  'POST /api/mentor/queue/claim': ['mentor'],
  'GET /api/mentor/submissions/:id': ['mentor'],
  'POST /api/mentor/submissions/:id/release': ['mentor'],
  'POST /api/mentor/submissions/:id/review': ['mentor'],
  'GET /api/mentor/students': ['mentor'],
  'GET /api/cabinet': ['student'],
  'GET /api/certificates': ['student'],
  'GET /api/certificates/:id/pdf': ['student'],
  'GET /api/verify/:token': 'public',
  'GET /api/manager/report': ['manager'],
  'GET /api/manager/failed-jobs': ['manager'],
  'POST /api/manager/failed-jobs/:id/retry': ['manager'],
  'GET /api/enrollments': ['student'],
  'POST /api/enrollments': ['student'],
  'GET /api/enrollments/:id': ['student'],
  'POST /api/enrollments/:id/promo': ['student'],
  'POST /api/enrollments/:id/checkout': ['student'],
  'GET /api/enrollments/:id/refund-preview': ['student'],
  'POST /api/enrollments/:id/cancel': ['student'],
  'GET /api/enrollments/:id/transfer-options': ['student'],
  'POST /api/enrollments/:id/transfer': ['student'],
  'GET /api/waitlist': ['student'],
  'POST /api/waitlist/:id': ['student'],
  'DELETE /api/waitlist/:id': ['student'],
  'POST /api/payments/webhook': 'public',
  'GET /api/admin/gateway': ['admin'],
  'PUT /api/admin/gateway': ['admin'],
  'GET /api/manager/students': ['manager'],
  'GET /api/manager/cohorts/:id/students': ['manager'],
  'GET /api/manager/cohorts/:id/waitlist': ['manager'],
  'GET /api/manager/cohorts/:id/payments': ['manager'],
  'PATCH /api/manager/cohorts/:id/capacity': ['manager'],
  'POST /api/manager/enrollments/:id/transfer': ['manager'],
  'POST /api/manager/enrollments/:id/exclude': ['manager'],
  'GET /api/manager/promos': ['manager'],
  'POST /api/manager/promos': ['manager'],
  'PATCH /api/manager/promos/:id': ['manager'],
  'GET /api/admin/staff': ['admin'],
  'POST /api/admin/staff': ['admin'],
  'PATCH /api/admin/staff/:id': ['admin'],
  'GET /api/manager/courses': ['manager'],
  'POST /api/manager/courses': ['manager'],
  'PATCH /api/manager/courses/:id': ['manager'],
  'GET /api/manager/mentors': ['manager'],
  'GET /api/manager/cohorts': ['manager'],
  'POST /api/manager/cohorts': ['manager'],
  'GET /api/manager/cohorts/:id': ['manager'],
  'PATCH /api/manager/cohorts/:id': ['manager'],
  'PATCH /api/manager/lessons/:id': ['manager'],
};

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

let api: TestApi;
let callers: Record<Role, Client>;

const registeredRoutes = (): string[] => {
  const instance = api.app.getHttpAdapter().getInstance() as { router: { stack: Layer[] } };
  return instance.router.stack.flatMap(({ route }) =>
    route && route.path.startsWith('/api')
      ? Object.keys(route.methods).map((method) => `${method.toUpperCase()} ${route.path}`)
      : [],
  );
};

const call = (http: Client, route: string) => {
  const [method = 'GET', path = '/'] = route.split(' ');
  const url = path.replace(/:\w+/g, '018f6f1e-7b1a-7c3e-9d6a-111111111111');
  return http.send(method, url, method === 'GET' ? {} : { body: {} });
};

beforeAll(async () => {
  api = await startApi();
  const staff = await staffedSchool(api);
  const student = await signedIn(api, 'student');
  callers = {
    student: student.http,
    mentor: staff.mentor.http,
    manager: staff.manager.http,
    admin: staff.admin.http,
  };
});
afterAll(async () => {
  await api.stop();
});

describe('route sweep', () => {
  it('knows the audience of every registered route', () => {
    expect(registeredRoutes().sort()).toEqual(Object.keys(ACCESS).sort());
  });

  it('answers 401 to anonymous callers on every protected route', async () => {
    for (const [route, access] of Object.entries(ACCESS)) {
      if (access === 'public') continue;
      expectError(await call(client(api.url), route), 'UNAUTHENTICATED');
    }
  });

  it.each(ROLES)('answers 403 to a %s on every route of other roles', async (role) => {
    for (const [route, access] of Object.entries(ACCESS)) {
      if (access === 'public') continue;
      const reply = await call(callers[role], route);
      if (access.includes(role)) {
        expect([route, reply.status]).not.toEqual([route, 403]);
        expect([route, reply.status]).not.toEqual([route, 401]);
        expect(reply.status).toBeLessThan(500);
      } else {
        expect([route, reply.status]).toEqual([route, 403]);
      }
    }
  });

  it('documents the shared error body on every operation', async () => {
    const reply = await client(api.url).get('/docs-json');
    const document = reply.body as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };
    const documented = Object.entries(document.paths).flatMap(([path, operations]) =>
      Object.keys(operations).map(
        (method) => `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`,
      ),
    );
    expect(documented.sort()).toEqual(Object.keys(ACCESS).sort());
    for (const operations of Object.values(document.paths)) {
      for (const operation of Object.values(operations)) {
        expect(JSON.stringify(operation.responses['400'])).toContain('schemas/ApiError');
        expect(JSON.stringify(operation.responses['500'])).toContain('schemas/ApiError');
      }
    }
  });
});

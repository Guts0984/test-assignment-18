import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from '../attacker/app';
import { burst } from '../attacker/burst';
import { client } from '../attacker/client';
import { expectError } from '../attacker/expect';
import { createAccount, PASSWORD, signedIn, staffedSchool } from '../attacker/people';

let api: TestApi;
beforeAll(async () => {
  api = await startApi({ copies: 2 });
});
afterAll(async () => {
  await api.stop();
});

const withAccessToken = (token: string) =>
  client(api.url).get('/api/auth/me', { headers: { cookie: `access_token=${token}` } });

const sign = (subject: string, secret: string, expiresAt: number, algorithm = 'HS256') =>
  new SignJWT()
    .setProtectedHeader({ alg: algorithm })
    .setIssuer('school-api')
    .setSubject(subject)
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret));

const soon = () => Math.floor(Date.now() / 1000) + 600;

describe('access tokens', () => {
  it('rejects forged, unsigned, expired and re-signed tokens', async () => {
    const { user } = await signedIn(api, 'student');
    const secret = api.deps.env.JWT_ACCESS_SECRET;
    const valid = await sign(user.id, secret, soon());
    expect((await withAccessToken(valid)).status).toBe(200);

    const [header = '', , signature = ''] = valid.split('.');
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const other = await createAccount(api, 'student');
    const swapped = `${header}.${encode({ iss: 'school-api', sub: other.id, exp: soon() })}.${signature}`;
    const unsigned = `${encode({ alg: 'none' })}.${encode({ iss: 'school-api', sub: user.id, exp: soon() })}.`;
    const attacks = [
      swapped,
      unsigned,
      await sign(user.id, 'a-different-secret-of-sufficient-length', soon()),
      await sign(user.id, secret, soon() - 3_600),
      await sign(user.id, secret, soon(), 'HS512'),
      await sign('not-a-uuid', secret, soon()),
      'garbage',
    ];
    for (const token of attacks) expectError(await withAccessToken(token), 'UNAUTHENTICATED');
  });

  it('stops working the moment the account is disabled', async () => {
    const { admin, school } = await staffedSchool(api);
    const mentor = await signedIn(api, 'mentor', school.id);
    const reply = await admin.http.patch(`/api/admin/staff/${mentor.user.id}`, { disabled: true });
    expect(reply.status).toBe(200);
    expectError(await mentor.http.get('/api/auth/me'), 'UNAUTHENTICATED');
    expectError(await mentor.http.post('/api/auth/refresh'), 'UNAUTHENTICATED');
    expectError(
      await client(api.url).post('/api/auth/login', {
        email: mentor.user.email,
        password: PASSWORD,
      }),
      'INVALID_CREDENTIALS',
    );
  });
});

describe('refresh tokens', () => {
  it('rotates, and a replayed token ends the whole family', async () => {
    const { http } = await signedIn(api, 'student');
    const stolen = http.cookies.get('refresh_token') ?? '';
    expect((await http.post('/api/auth/refresh')).status).toBe(200);
    const current = http.cookies.get('refresh_token') ?? '';
    expect(current).not.toBe(stolen);

    const replay = (token: string) =>
      client(api.url).post('/api/auth/refresh', undefined, {
        headers: { cookie: `refresh_token=${token}` },
      });
    expectError(await replay(stolen), 'TOKEN_REUSED');
    expectError(await replay(current), 'UNAUTHENTICATED');
  });

  it('lets one of many simultaneous uses through and revokes the rest', async () => {
    const { http, user } = await signedIn(api, 'student');
    const token = http.cookies.get('refresh_token') ?? '';
    const replies = await burst(10, (index) =>
      client(api.copies[index % 2]?.url ?? api.url).post('/api/auth/refresh', undefined, {
        headers: { cookie: `refresh_token=${token}` },
      }),
    );
    expect(replies.filter((reply) => reply.status === 200)).toHaveLength(1);
    expect(replies.every((reply) => [200, 401].includes(reply.status))).toBe(true);
    expect(await api.db.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(
      0,
    );
  });

  it('ends the session on logout, and stores only hashes', async () => {
    const { http, user } = await signedIn(api, 'student');
    const token = http.cookies.get('refresh_token') ?? '';
    const stored = await api.db.refreshToken.findMany({ where: { userId: user.id } });
    expect(JSON.stringify(stored)).not.toContain(token);
    expect((await http.post('/api/auth/logout')).status).toBe(204);
    expect(http.cookies.size).toBe(0);
    expectError(
      await client(api.url).post('/api/auth/refresh', undefined, {
        headers: { cookie: `refresh_token=${token}` },
      }),
      'UNAUTHENTICATED',
    );
  });

  it('keeps cookies away from scripts and scoped', async () => {
    const user = await createAccount(api, 'student');
    const reply = await client(api.url).post('/api/auth/login', {
      email: user.email,
      password: PASSWORD,
    });
    const cookies = [reply.headers['set-cookie']].flat().join('\n');
    expect(cookies).toMatch(/access_token=[^;]+;.*HttpOnly.*SameSite=Lax/);
    expect(cookies).toMatch(/refresh_token=[^;]+;.*Path=\/api\/auth;.*HttpOnly/);
    expect(reply.text).not.toContain('password');
  });
});

describe('account enumeration', () => {
  it('answers an unknown address and a wrong password identically', async () => {
    const user = await createAccount(api, 'student');
    const attempt = (email: string) =>
      client(api.url).post('/api/auth/login', { email, password: 'wrong-password-123' });
    const known = await attempt(user.email);
    const unknown = await attempt('nobody@example.test');
    const strip = (body: unknown) => ({ ...(body as object), requestId: undefined });
    expect(strip(known.body)).toEqual(strip(unknown.body));
    expectError(known, 'INVALID_CREDENTIALS');
  });

  it('answers a taken address like a free one and leaves the account alone', async () => {
    const user = await createAccount(api, 'manager', (await staffedSchool(api)).school.id);
    const register = (email: string) =>
      client(api.url).post('/api/auth/register', {
        email,
        password: 'attacker-password-1',
        fullName: 'Mallory',
        timeZone: 'Europe/Kyiv',
      });
    const taken = await register(user.email.toUpperCase());
    const free = await register('free-address@example.test');
    expect([taken.status, taken.text]).toEqual([free.status, free.text]);
    expect(taken.headers['set-cookie']).toBeUndefined();
    const stored = await api.db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect([stored.passwordHash, stored.role]).toEqual([user.passwordHash, 'manager']);
  });

  it('creates exactly one account when the same address registers 20 times at once', async () => {
    const email = 'race@example.test';
    const replies = await burst(20, () =>
      client(api.url).post('/api/auth/register', {
        email,
        password: 'long-enough-password',
        fullName: 'Racer',
        timeZone: 'Europe/Kyiv',
      }),
    );
    expect(new Set(replies.map((reply) => reply.status))).toEqual(new Set([202]));
    expect(await api.db.user.count({ where: { email } })).toBe(1);
  });
});

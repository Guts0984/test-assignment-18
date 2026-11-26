import { createRedis } from '../../src/infra/redis';
import { createLogger } from '../../src/infra/logger';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from '../attacker/app';
import { burst } from '../attacker/burst';
import { client, type Reply } from '../attacker/client';
import { expectError } from '../attacker/expect';
import { createAccount, PASSWORD } from '../attacker/people';

/** The limiter profile: tight windows, two api copies sharing Redis. */
const PROFILE = {
  RATE_LIMIT_LOGIN_IP_MAX: '5',
  RATE_LIMIT_LOGIN_IP_WINDOW_SEC: '60',
  RATE_LIMIT_LOGIN_ACCOUNT_MAX: '3',
  RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_SEC: '60',
  RATE_LIMIT_REGISTER_IP_MAX: '3',
};

let api: TestApi;
beforeAll(async () => {
  api = await startApi({ copies: 2, env: PROFILE });
});
afterAll(async () => {
  await api.stop();
});

const guess = (ip: string, email: string, headers: Record<string, string> = {}, copy = 0) =>
  client(api.copies[copy]?.url ?? api.url, { ip }).post(
    '/api/auth/login',
    { email, password: 'wrong-password-123' },
    { headers },
  );

const statuses = (replies: readonly Reply[]) => replies.map((reply) => reply.status).sort();

describe('login limiter', () => {
  it('stops a flood from one address and leaves every other address alone', async () => {
    const victim = await createAccount(api, 'student');
    const flood = await burst(50, (i) => guess('127.0.0.2', `user${i}@example.test`, {}, i % 2));
    expect(statuses(flood).filter((status) => status === 401)).toHaveLength(5);
    const limited = flood.find((reply) => reply.status === 429);
    expect(limited && Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    if (limited) expectError(limited, 'RATE_LIMITED');

    for (const ip of ['127.0.0.3', '127.0.0.4']) {
      const reply = await client(api.url, { ip }).post('/api/auth/login', {
        email: victim.email,
        password: PASSWORD,
      });
      expect(reply.status).toBe(200);
    }
  });

  it('counts one window across both api copies, even for simultaneous requests', async () => {
    const replies = await burst(40, (i) => guess('127.0.0.5', `x${i}@example.test`, {}, i % 2));
    expect(replies.filter((reply) => reply.status !== 429)).toHaveLength(5);
  });

  it('ignores spoofed forwarding headers: no bypass, and no blocking of a victim', async () => {
    const victim = await createAccount(api, 'student');
    const replies = [];
    for (let i = 0; i < 12; i += 1) {
      replies.push(
        await guess('127.0.0.6', `s${i}@example.test`, {
          'x-forwarded-for': `10.9.${i}.1, 127.0.0.7`,
          'x-real-ip': '127.0.0.7',
          forwarded: `for=10.9.${i}.2`,
        }),
      );
    }
    expect(replies.filter((reply) => reply.status === 401)).toHaveLength(5);
    const victimReply = await client(api.url, { ip: '127.0.0.7' }).post('/api/auth/login', {
      email: victim.email,
      password: PASSWORD,
    });
    expect(victimReply.status).toBe(200);
  });

  it('limits guesses per account without letting anyone lock the owner out', async () => {
    const victim = await createAccount(api, 'student');
    const attack = [];
    for (let i = 0; i < 5; i += 1) {
      attack.push(await guess('127.0.0.8', ` ${victim.email.toUpperCase()} `));
    }
    expect(attack.map((reply) => reply.status)).toEqual([401, 401, 401, 429, 429]);
    const owner = await client(api.url, { ip: '127.0.0.9' }).post('/api/auth/login', {
      email: victim.email,
      password: PASSWORD,
    });
    expect(owner.status).toBe(200);
  });

  it('limits registration per address, but not other routes', async () => {
    const register = (i: number) =>
      client(api.url, { ip: '127.0.0.10' }).post('/api/auth/register', {
        email: `new${i}@example.test`,
        password: 'long-enough-password',
        fullName: 'New Student',
        timeZone: 'Europe/Kyiv',
      });
    const replies = await burst(10, register);
    expect(replies.filter((reply) => reply.status === 202)).toHaveLength(3);
    const browsing = await burst(60, () =>
      client(api.url, { ip: '127.0.0.10' }).get('/api/catalog/cohorts'),
    );
    expect(new Set(browsing.map((reply) => reply.status))).toEqual(new Set([200]));
  });

  it('sets an expiry on every counter', async () => {
    await guess('127.0.0.11', 'ttl@example.test');
    const prefix = api.deps.redis.options.keyPrefix ?? '';
    const raw = createRedis(api.deps.env.REDIS_URL, createLogger('silent'));
    await new Promise((resolve) => raw.once('ready', resolve));
    const keys = await raw.keys(`${prefix}rl:*`);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(await raw.ttl(key)).toBeGreaterThan(0);
    raw.disconnect();
  });
});

describe('trusted proxy', () => {
  it('keys by the X-Real-IP that the proxy sets', async () => {
    const proxied = await startApi({
      env: { ...PROFILE, TRUSTED_PROXY_CIDRS: '127.0.0.1/32' },
    });
    const from = (realIp: string, i: number) =>
      client(proxied.url).post(
        '/api/auth/login',
        { email: `p${i}@example.test`, password: 'wrong-password-123' },
        { headers: { 'x-real-ip': realIp } },
      );
    const flooded = await burst(8, (i) => from('203.0.113.1', i));
    expect(flooded.filter((reply) => reply.status === 429)).toHaveLength(3);
    expect((await from('203.0.113.2', 99)).status).toBe(401);
    await proxied.stop();
  });
});

describe('when Redis is down', () => {
  const unreachable = { ...PROFILE, REDIS_URL: 'redis://127.0.0.1:1' };

  it('fails open by default: sign-in and browsing keep working', async () => {
    const down = await startApi({ env: unreachable });
    const user = await createAccount(down, 'student');
    const replies = await burst(8, () =>
      client(down.url).post('/api/auth/login', { email: user.email, password: PASSWORD }),
    );
    expect(new Set(replies.map((reply) => reply.status))).toEqual(new Set([200]));
    expect((await client(down.url).get('/api/catalog/cohorts')).status).toBe(200);
    expect((await client(down.url).get('/api/health')).status).toBe(200);
    await down.stop();
  });

  it('fails closed when configured to, with a clear error', async () => {
    const down = await startApi({ env: { ...unreachable, RATE_LIMIT_FAIL_MODE: 'closed' } });
    const reply = await client(down.url).post('/api/auth/login', {
      email: 'a@example.test',
      password: 'x',
    });
    expectError(reply, 'SERVICE_UNAVAILABLE');
    await down.stop();
  });
});

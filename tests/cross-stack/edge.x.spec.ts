import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { client } from '../../apps/api/test/attacker/client';
import * as stack from '../support/stack';

afterAll(stack.disconnect);

describe('through nginx', () => {
  it('serves the web app, the api, the documentation, the payment pages and both api copies', async () => {
    const anyone = client(stack.URLS.public);
    for (const path of ['/', '/docs', '/docs-json', '/paystub/', '/api/health']) {
      expect([path, (await anyone.get(path)).status]).toEqual([path, 200]);
    }
    const copies = new Set<unknown>();
    for (let i = 0; i < 8; i += 1) {
      copies.add((await anyone.get('/api/health')).headers['x-instance']);
    }
    expect(copies).toEqual(new Set(['api-1', 'api-2']));
  });

  it('overwrites forwarding headers, so a client cannot choose the address it is limited by', async () => {
    const redis = new Redis(process.env['REDIS_URL'] ?? '');
    const spoofed = '203.0.113.77';
    await client(stack.URLS.public).post(
      '/api/auth/login',
      { email: 'spoofer@example.test', password: 'wrong-password-123' },
      { headers: { 'x-real-ip': spoofed, 'x-forwarded-for': spoofed } },
    );
    const keys = await redis.keys('*rl:login:ip:*');
    redis.disconnect();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => key.includes(spoofed))).toEqual([]);
  });

  it('answers its own errors in the shared error shape', async () => {
    const anyone = client(stack.URLS.public);
    const nul = await anyone.get('/api/%00');
    const long = await anyone.get(`/api/${'a'.repeat(20_000)}`);
    const big = await anyone.send('POST', '/api/auth/login', { raw: 'x'.repeat(12_000_000) });
    for (const [reply, status, code] of [
      [nul, 400, 'MALFORMED_REQUEST'],
      [long, 414, 'MALFORMED_REQUEST'],
      [big, 413, 'PAYLOAD_TOO_LARGE'],
    ] as const) {
      expect([reply.status, reply.headers['content-type']]).toEqual([status, 'application/json']);
      expect(reply.body).toMatchObject({ code });
    }
  });

  it('loses no request while one api copy stops and starts', async () => {
    const failures: string[] = [];
    let running = true;
    let sent = 0;
    const traffic = async (index: number) => {
      const anyone = client(stack.URLS.public);
      while (running) {
        // Reads and writes: a lost POST is not retried by the proxy.
        const reply =
          index % 2 === 0
            ? await anyone.get('/api/catalog/directions')
            : await anyone.post('/api/auth/refresh');
        sent += 1;
        const expected = index % 2 === 0 ? 200 : 401;
        if (reply.status !== expected) failures.push(`${reply.status} ${reply.text.slice(0, 80)}`);
      }
    };
    const clients = Array.from({ length: 8 }, (_, i) => traffic(i));
    // One copy at a time, as in a rolling restart: the next one leaves only when the proxy is
    // sending requests to the one that came back.
    for (const copy of ['api-1', 'api-2']) {
      await stack.apiCopy.stop(copy);
      await stack.apiCopy.start(copy);
      await stack.until(
        async () =>
          (await client(stack.URLS.public).get('/api/health')).headers['x-instance'] === copy,
        `${copy} to be back in rotation`,
      );
    }
    running = false;
    await Promise.all(clients);
    expect(sent).toBeGreaterThan(100);
    expect(failures).toEqual([]);
  });

  it('refuses foreign origins', async () => {
    const anyone = client(stack.URLS.public);
    const forged = await anyone.post(
      '/api/auth/logout',
      {},
      { headers: { origin: 'https://evil.example' } },
    );
    expect(forged.status).toBe(403);
  });
});

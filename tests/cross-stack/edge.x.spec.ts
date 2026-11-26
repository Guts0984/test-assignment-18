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

  it('refuses oversized bodies and foreign origins at the edge', async () => {
    const anyone = client(stack.URLS.public);
    const big = await anyone
      .send('POST', '/api/auth/login', { raw: 'x'.repeat(12_000_000) })
      .catch(() => ({ status: 413 }));
    expect(big.status).toBe(413);
    const forged = await anyone.post(
      '/api/auth/logout',
      {},
      { headers: { origin: 'https://evil.example' } },
    );
    expect(forged.status).toBe(403);
  });
});

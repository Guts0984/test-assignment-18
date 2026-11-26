import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, type Client } from '../../apps/api/test/attacker/client';
import * as stack from '../support/stack';

const RUNS = 40;
const PASSWORD = process.env['SEED_DEMO_PASSWORD'] ?? 'demo-password-2026';

const signIn = async (email: string): Promise<Client> => {
  const http = client(stack.URLS.public);
  const reply = await http.post('/api/auth/login', { email, password: PASSWORD });
  expect(reply.status).toBe(200);
  return http;
};

let manager: Client;
let mentor: Client;

beforeAll(async () => {
  expect(await stack.db().enrollment.count()).toBeGreaterThanOrEqual(500_000);
  manager = await signIn('manager@school1.example.test');
  mentor = await signIn('mentor1@school1.example.test');
});
afterAll(stack.disconnect);

/** The 95th percentile of repeated requests, in milliseconds, after a warm-up. */
const p95 = async (http: Client, paths: readonly string[]): Promise<number> => {
  for (const path of paths) await http.get(path);
  const times: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const path = paths[run % paths.length] ?? '';
    const started = performance.now();
    const reply = await http.get(path);
    times.push(performance.now() - started);
    expect([path, reply.status]).toEqual([path, 200]);
  }
  times.sort((a, b) => a - b);
  return times[Math.ceil(RUNS * 0.95) - 1] ?? Infinity;
};

const within = async (name: string, budget: number, measured: Promise<number>) => {
  const ms = await measured;
  process.stdout.write(`perf: ${name} p95 ${ms.toFixed(0)} ms (budget ${budget} ms)\n`);
  expect(ms).toBeLessThan(budget);
};

describe('A-16 speed on the full data set', () => {
  it('searches the catalog in under 200 ms', async () => {
    await within(
      'catalog search',
      200,
      p95(client(stack.URLS.public), [
        '/api/catalog/cohorts',
        '/api/catalog/cohorts?q=type',
        '/api/catalog/cohorts?q=python&direction=data',
        '/api/catalog/cohorts?currency=EUR&priceMin=100&priceMax=100000',
        '/api/catalog/cohorts?startFrom=2027-01-01&startTo=2027-06-01&page=2',
      ]),
    );
  });

  it('opens the mentor queue in under 200 ms', async () => {
    const queue = await mentor.get('/api/mentor/queue');
    expect((queue.body as { total: number }).total).toBeGreaterThan(0);
    await within(
      'mentor queue',
      200,
      p95(mentor, ['/api/mentor/queue', '/api/mentor/queue?page=3']),
    );
  });

  it('finds a student by name or e-mail in under 300 ms', async () => {
    await within(
      'student search',
      300,
      p95(manager, [
        '/api/manager/students?q=olena',
        '/api/manager/students?q=shevchenko%201',
        '/api/manager/students?q=student1234',
        '/api/manager/students?q=%40students',
      ]),
    );
  });

  it('builds the twelve-month report in under 1 s', async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 364 * 86_400_000);
    const day = (date: Date) => date.toISOString().slice(0, 10);
    await within(
      '12-month report',
      1_000,
      p95(manager, [`/api/manager/report?from=${day(from)}&to=${day(to)}`]),
    );
  });
});

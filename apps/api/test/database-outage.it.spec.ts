import { connect, createServer, type AddressInfo, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from './attacker/app';
import { client } from './attacker/client';
import { expectError } from './attacker/expect';
import { signedIn } from './attacker/people';
import { until } from './attacker/poll';

/** A TCP relay in front of Postgres that a test can cut. */
const relay = async (target: string) => {
  const { hostname, port } = new URL(target);
  const open = new Set<Socket>();
  const server = createServer((incoming) => {
    const outgoing = connect(Number(port), hostname);
    for (const socket of [incoming, outgoing]) {
      open.add(socket);
      socket.on('error', () => socket.destroy());
      socket.on('close', () => {
        incoming.destroy();
        outgoing.destroy();
      });
    }
    incoming.pipe(outgoing).pipe(incoming);
  });
  const listen = (on: number) =>
    new Promise<void>((resolve) => server.listen(on, '127.0.0.1', resolve));
  await listen(0);
  const own = (server.address() as AddressInfo).port;
  return {
    url: (url: string) => {
      const through = new URL(url);
      through.host = `127.0.0.1:${own}`;
      through.searchParams.set('connect_timeout', '2');
      through.searchParams.set('pool_timeout', '3');
      return through.toString();
    },
    cut: async () => {
      const closed = new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      for (const socket of open) socket.destroy();
      await closed;
    },
    restore: () => listen(own),
  };
};

let api: TestApi;
let gate: Awaited<ReturnType<typeof relay>>;

beforeAll(async () => {
  gate = await relay(process.env['DATABASE_URL'] ?? '');
  api = await startApi({ databaseUrl: gate.url });
});
afterAll(async () => {
  await api.stop();
  await gate.cut();
});

describe('while Postgres cannot be reached', () => {
  it('answers 503 with the shared error shape, and recovers by itself', async () => {
    const { http, user } = await signedIn(api, 'student');
    expect((await client(api.url).get('/api/health')).status).toBe(200);
    await gate.cut();
    for (let i = 0; i < 2; i += 1) {
      const replies = await Promise.all([
        client(api.url).get('/api/health'),
        client(api.url).get('/api/catalog/cohorts'),
        client(api.url).post('/api/auth/login', { email: user.email, password: 'whatever-123' }),
        http.get('/api/cabinet'),
      ]);
      for (const reply of replies) expectError(reply, 'SERVICE_UNAVAILABLE');
    }
    await gate.restore();
    // The pool reconnects on its own; no restart is needed.
    await until(async () => (await client(api.url).get('/api/health')).status === 200, {
      what: 'the api to recover',
    });
    expect((await http.get('/api/cabinet')).status).toBe(200);
  });
});

import { createSharedTestTime } from '@school/db/time';
import { describe, expect, it } from 'vitest';
import { startApi } from './attacker/app';
import { client } from './attacker/client';
import { expectError } from './attacker/expect';

const TOKEN = 'a-test-control-token-1234';
const target = '2030-01-01T00:00:00.000Z';

describe('test clock', () => {
  it('does not exist unless enabled', async () => {
    const api = await startApi();
    const reply = await client(api.url).post(
      '/api/__test/clock',
      { now: target },
      { headers: { 'x-test-token': TOKEN } },
    );
    expectError(reply, 'NOT_FOUND');
    await api.stop();
  });

  it('needs the token, and moves the time every process reads', async () => {
    const api = await startApi({ env: { TEST_CLOCK_ENABLED: 'true', TEST_CONTROL_TOKEN: TOKEN } });
    const move = (token?: string) =>
      client(api.url).post(
        '/api/__test/clock',
        { now: target },
        token ? { headers: { 'x-test-token': token } } : {},
      );
    expectError(await move(), 'UNAUTHENTICATED');
    expectError(await move(`${TOKEN}x`), 'UNAUTHENTICATED');
    const shared = createSharedTestTime(api.db);
    expect((await shared.now()).getUTCFullYear()).toBeLessThan(2030);
    expect((await move(TOKEN)).status).toBe(200);
    expect((await shared.now()).toISOString().slice(0, 16)).toBe('2030-01-01T00:00');
    await api.stop();
  });
});

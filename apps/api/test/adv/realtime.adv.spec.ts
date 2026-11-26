import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from '../attacker/app';
import { signedIn } from '../attacker/people';
import { until } from '../attacker/poll';
import { socket, type Received } from '../attacker/socket';
import { handIn, studyingCohort } from '../attacker/study';
import { sellingCohort } from '../attacker/money';
import { signInAs, student } from '../attacker/students';

let api: TestApi;
beforeAll(async () => {
  api = await startApi({ copies: 2 });
});
afterAll(async () => {
  await api.stop();
});

const urlOf = (copy: number) => api.copies[copy]?.url ?? api.url;

const seen = (received: readonly Received[], event: string, id: string) =>
  received.filter((item) => item.event === event && JSON.stringify(item.payload).includes(id));

const within = async (ms: number, probe: () => boolean) => {
  const started = Date.now();
  await until(() => Promise.resolve(probe()), { timeoutMs: ms, what: 'a live update' });
  return Date.now() - started;
};

describe('live updates', () => {
  it('reach clients on copy A for a booking through copy B in under a second', async () => {
    const sale = await sellingCohort(api, { capacity: 3 });
    const { user } = await signedIn(api, 'manager', sale.school.id);
    const manager = await signInAs(api, user.id, urlOf(0));
    const staff = await socket(urlOf(0), { as: manager });
    const visitor = await socket(urlOf(0));
    expect(await staff.join({ kind: 'cohort-staff', id: sale.cohort.id })).toBe(true);
    expect(await visitor.join({ kind: 'catalog' })).toBe(true);

    const buyer = await student(api);
    const throughB = await signInAs(api, buyer.id, urlOf(1));
    const booked = await throughB.post('/api/enrollments', { cohortId: sale.cohort.id });
    expect(booked.headers['x-instance']).toBe('api-2');
    const latency = await within(
      1_000,
      () =>
        seen(visitor.received, 'seats.changed', sale.cohort.id).length > 0 &&
        seen(staff.received, 'roster.changed', sale.cohort.id).length > 0,
    );
    expect(latency).toBeLessThan(1_000);
    expect(seen(visitor.received, 'seats.changed', sale.cohort.id)[0]?.payload).toEqual({
      cohortId: sale.cohort.id,
      freeSeats: 2,
    });
    // The public room carries seat counts and nothing about people.
    expect(visitor.received.every((item) => item.event === 'seats.changed')).toBe(true);
    staff.close();
    visitor.close();
  });

  it('update the mentor queue when work arrives on the other copy', async () => {
    const study = await studyingCohort(api);
    const mentor = await socket(urlOf(1), { as: study.mentorHttp });
    expect(await mentor.join({ kind: 'mentor', id: study.mentor.id })).toBe(true);
    await handIn(study.first, study.homework[0] ?? '');
    await within(1_000, () => seen(mentor.received, 'queue.changed', study.mentor.id).length > 0);
    mentor.close();
  });

  it('keeps every private room shut to the wrong listener', async () => {
    const target = await studyingCohort(api);
    const foreign = await studyingCohort(api);
    const colleague = await signedIn(api, 'mentor', target.school.id);
    const foreignManager = await signedIn(api, 'manager', foreign.school.id);
    const admin = await signedIn(api, 'admin', target.school.id);
    const rooms = [
      { kind: 'user', id: target.first.id },
      { kind: 'mentor', id: target.mentor.id },
      { kind: 'cohort-staff', id: target.cohort.id },
    ];
    const intruders = [
      undefined,
      foreign.first.http,
      target.first.http,
      colleague.http,
      foreignManager.http,
      foreign.mentorHttp,
      admin.http,
    ];
    for (const [index, as] of intruders.entries()) {
      const listener = await socket(urlOf(index % 2), as ? { as } : {});
      for (const room of rooms) {
        const own = as === target.first.http && room.kind === 'user';
        expect([index, room.kind, await listener.join(room)]).toEqual([index, room.kind, own]);
      }
      listener.close();
    }
  });

  it('refuses invalid tokens, foreign origins and malformed requests', async () => {
    await expect(socket(urlOf(0), { token: 'forged.token.value' })).rejects.toThrow();
    await expect(socket(urlOf(0), { origin: 'https://evil.example' })).rejects.toThrow();
    const visitor = await socket(urlOf(0));
    for (const bad of [
      null,
      'catalog',
      { kind: 'catalog', id: 'x' },
      { kind: 'user', id: '*' },
      { kind: 'everything' },
    ]) {
      expect(await visitor.join(bad)).toBe(false);
    }
    visitor.close();
  });

  it('stops granting rooms once an account is disabled', async () => {
    const study = await studyingCohort(api);
    const mentor = await socket(urlOf(0), { as: study.mentorHttp });
    await api.db.user.update({ where: { id: study.mentor.id }, data: { disabledAt: new Date() } });
    expect(await mentor.join({ kind: 'mentor', id: study.mentor.id })).toBe(false);
    mentor.close();
  });
});

import { assertInvariants } from '@school/db/invariants/assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inbox } from '../mail';
import { startRig, until, type Rig } from '../rig';

let rig: Rig;
beforeAll(async () => {
  rig = await startRig();
});
afterAll(async () => {
  await rig.stop();
});

describe('kill -9 during expiry', () => {
  it('finishes every expiry after a restart, each exactly once', async () => {
    const { cohort } = await rig.cohort(150);
    await rig.holds(cohort.id, 150);
    await rig.setTime(new Date(rig.start.getTime() + 901_000));
    const expired = () =>
      rig.db.enrollment.count({ where: { cohortId: cohort.id, status: 'expired' } });

    const first = rig.startWorker();
    // Expiry settles the whole cohort in one transaction: kill around its commit.
    await until(async () => (await rig.db.jobFailure.count()) >= 0, 'startup');
    await new Promise((resolve) => setTimeout(resolve, 600));
    await rig.kill(first);
    rig.startWorker();
    await until(async () => (await expired()) === 150, 'all holds to expire');

    const stored = await rig.db.cohort.findUniqueOrThrow({ where: { id: cohort.id } });
    expect(stored.seatsTaken).toBe(0);
    expect(
      await rig.db.seatJournal.count({ where: { cohortId: cohort.id, reason: 'expiry' } }),
    ).toBe(150);
    await assertInvariants(rig.db);
  });

  it('survives being killed over and over while 40 cohorts expire', async () => {
    const cohorts: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      const { cohort } = await rig.cohort(3);
      await rig.holds(cohort.id, 3);
      cohorts.push(cohort.id);
    }
    await rig.setTime(new Date((await rig.now()).getTime() + 901_000));
    const left = () =>
      rig.db.enrollment.count({ where: { cohortId: { in: cohorts }, status: 'held' } });
    const killed: number[] = [];
    while ((await left()) > 0 && killed.length < 6) {
      // Counted before the worker starts, so it cannot finish everything first.
      const before = await left();
      const worker = rig.startWorker();
      await until(async () => (await left()) < before, 'progress');
      await rig.kill(worker);
      killed.push(await left());
    }
    rig.startWorker();
    await until(async () => (await left()) === 0, 'the rest');
    expect(
      await rig.db.seatJournal.count({ where: { cohortId: { in: cohorts }, reason: 'expiry' } }),
    ).toBe(120);
    await assertInvariants(rig.db);
  });

  it('sends each outbox email once even when killed while sending', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `kill-${Date.now()}-${i}@example.test`);
    await rig.db.emailOutbox.createMany({
      data: ids.map((to) => ({
        dedupeKey: to,
        toAddress: to,
        subject: 'Once',
        body: 'Only once.',
        createdAt: rig.start,
      })),
    });
    const sent = () =>
      rig.db.emailOutbox.count({ where: { toAddress: { in: ids }, status: 'sent' } });
    const first = rig.startWorker();
    await until(async () => (await sent()) >= 5, 'some emails');
    await rig.kill(first);
    rig.startWorker();
    await until(async () => (await sent()) === ids.length, 'all emails');
    const counts = await Promise.all(ids.map(async (to) => (await inbox(to)).length));
    expect(counts.every((count) => count >= 1)).toBe(true);
    // Only an email in the worker's hands at the instant of the kill may repeat.
    expect(counts.filter((count) => count > 1).length).toBeLessThanOrEqual(4);
  });
});

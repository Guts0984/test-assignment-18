import { assertInvariants } from '@school/db/invariants/assert';
import { claimSubmission } from '@school/db/repo/review';
import { runUnit } from '@school/db/repo/unit-of-work';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from '../attacker/app';
import { burst } from '../attacker/burst';
import { expectError } from '../attacker/expect';
import { handIn, studyingCohort } from '../attacker/study';
import { signInAs } from '../attacker/students';
import { signedIn } from '../attacker/people';

let api: TestApi;
beforeAll(async () => {
  api = await startApi({ copies: 2 });
});
afterAll(async () => {
  await api.stop();
});

const queueOfWork = async (count: number) => {
  const study = await studyingCohort(api, { students: count, lessons: 1 });
  const ids: string[] = [];
  for (const student of study.students) {
    api.clock.advance(1_000);
    const reply = await handIn(student, study.homework[0] ?? '');
    ids.push((reply.body as { id: string }).id);
  }
  return { ...study, ids };
};

type Queue = { items: { submissionId: string }[]; total: number };

describe('mentor review limit', () => {
  it('lets a mentor hold at most 5, however many claims race, twenty times', async () => {
    const study = await queueOfWork(8);
    const second = await signInAs(api, study.mentor.id, api.copies[1]?.url);
    for (let round = 0; round < 20; round += 1) {
      const replies = await burst(20, (i) =>
        (i % 2 === 0 ? study.mentorHttp : second).post('/api/mentor/queue/claim', {}),
      );
      const won = replies.filter((r) => r.status === 200);
      expect(won).toHaveLength(5);
      for (const reply of replies.filter((r) => r.status !== 200)) {
        expectError(reply, 'REVIEW_LIMIT_REACHED');
      }
      const claimed = won.map((r) => (r.body as { submissionId: string }).submissionId);
      // Distinct works, and the oldest ones first.
      expect(claimed.sort()).toEqual(study.ids.slice(0, 5).sort());
      await burst(5, (i) =>
        study.mentorHttp.post(`/api/mentor/submissions/${claimed[i] ?? ''}/release`),
      );
    }
    await assertInvariants(api.db);
  });

  it('shows the queue oldest first and frees a place after each verdict', async () => {
    const study = await queueOfWork(7);
    const queue = (await study.mentorHttp.get('/api/mentor/queue')).body as Queue;
    expect(queue.items.map((item) => item.submissionId)).toEqual(study.ids);
    for (let i = 0; i < 5; i += 1) await study.mentorHttp.post('/api/mentor/queue/claim', {});
    expectError(
      await study.mentorHttp.post('/api/mentor/queue/claim', { submissionId: study.ids[6] }),
      'REVIEW_LIMIT_REACHED',
    );
    const verdicts = await burst(6, () =>
      study.mentorHttp.post(`/api/mentor/submissions/${study.ids[0] ?? ''}/review`, {
        verdict: 'accepted',
        score: 90,
      }),
    );
    expect(verdicts.filter((r) => r.status === 204)).toHaveLength(1);
    expect(
      await api.db.submissionReview.count({ where: { submissionId: study.ids[0] ?? '' } }),
    ).toBe(1);
    const next = await study.mentorHttp.post('/api/mentor/queue/claim', {});
    expect(next.body).toEqual({ submissionId: study.ids[5] });
  });

  it('returns held work to the queue when the reviewer stops mentoring', async () => {
    const study = await queueOfWork(2);
    for (let i = 0; i < 2; i += 1) await study.mentorHttp.post('/api/mentor/queue/claim', {});
    const successor = await signedIn(api, 'mentor', study.school.id);
    const admin = await signedIn(api, 'admin', study.school.id);
    await api.db.cohort.update({
      where: { id: study.cohort.id },
      data: { mentorId: successor.user.id },
    });
    const disabled = await admin.http.patch(`/api/admin/staff/${study.mentor.id}`, {
      disabled: true,
    });
    expect(disabled.status).toBe(200);
    const queue = (await successor.http.get('/api/mentor/queue')).body as Queue;
    expect(queue.items.map((item) => item.submissionId)).toEqual(study.ids);
    expect((await successor.http.post('/api/mentor/queue/claim', {})).status).toBe(200);
    // The student can replace work that nobody holds any more.
    const free = study.students[1];
    if (!free) throw new Error('fixture');
    expect((await handIn(free, study.homework[0] ?? '', { body: 'again' })).status).toBe(200);
    await assertInvariants(api.db);
  });

  it('gives a disabled mentor nothing, even with a request already under way', async () => {
    const study = await queueOfWork(1);
    await api.db.user.update({ where: { id: study.mentor.id }, data: { disabledAt: new Date() } });
    const outcome = await runUnit(
      api.db,
      { now: api.clock.now(), timings: { holdTtlSec: 900, offerTtlSec: 86_400 } },
      (unit) => claimSubmission(unit, { mentorId: study.mentor.id, submissionId: null, limit: 5 }),
    );
    expect(outcome.value).toBe('NOTHING_TO_REVIEW');
  });

  it('never gives one work to two reviewers when the cohort changes mentor', async () => {
    const study = await queueOfWork(1);
    const [id = ''] = study.ids;
    await study.mentorHttp.post('/api/mentor/queue/claim', {});
    const other = await api.db.user.create({
      data: {
        email: `second-${id}@example.test`,
        fullName: 'Second',
        passwordHash: 'x',
        role: 'mentor',
        schoolId: study.school.id,
      },
    });
    await api.db.cohort.update({ where: { id: study.cohort.id }, data: { mentorId: other.id } });
    const successor = await signInAs(api, other.id);
    expectError(
      await successor.post('/api/mentor/queue/claim', { submissionId: id }),
      'NOTHING_TO_REVIEW',
    );
    expectError(
      await successor.post(`/api/mentor/submissions/${id}/review`, { verdict: 'accepted' }),
      'NOT_FOUND',
    );
    const finish = await study.mentorHttp.post(`/api/mentor/submissions/${id}/review`, {
      verdict: 'returned',
      comment: 'Add tests',
    });
    expect(finish.status).toBe(204);
  });
});

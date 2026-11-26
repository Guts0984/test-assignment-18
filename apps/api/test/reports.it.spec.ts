import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOW, startApi, type TestApi } from './attacker/app';
import { expectError } from './attacker/expect';
import { signedIn } from './attacker/people';
import { studyingCohort } from './attacker/study';
import { issueFor } from './attacker/certificates';
import { createEnrollment } from '@school/db/testing/factories';
import { retryJob } from '@school/shared/jobs/retry';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.stop();
});

describe('manager report', () => {
  it('matches a hand-computed fixture and sees only its own school', async () => {
    api.clock.set(NOW);
    const study = await studyingCohort(api, { students: 2, lessons: 2 });
    const second = study.students[1];
    if (!second) throw new Error('fixture');
    // 10,000 and 5,000 paid, 2,000 of it returned.
    for (const [enrollmentId, amountMinor] of [
      [study.first.enrollmentId, 10_000],
      [second.enrollmentId, 5_000],
    ] as const) {
      await api.db.moneyOperation.create({
        data: {
          enrollmentId,
          kind: 'payment',
          amountMinor,
          currency: 'UAH',
          providerPaymentId: randomUUID(),
          createdAt: NOW,
        },
      });
    }
    const request = await api.db.refundRequest.create({
      data: {
        enrollmentId: second.enrollmentId,
        amountMinor: 2_000,
        currency: 'UAH',
        reason: 'cancel',
        createdAt: NOW,
      },
    });
    await api.db.moneyOperation.create({
      data: {
        enrollmentId: second.enrollmentId,
        kind: 'refund',
        amountMinor: 2_000,
        currency: 'UAH',
        refundRequestId: request.id,
        createdAt: NOW,
      },
    });
    await api.db.refundRequest.update({
      where: { id: request.id },
      data: { status: 'succeeded' },
    });
    // Offers: one paid, one that ran out.
    for (const status of ['converted', 'offer_expired']) {
      const enrollment = await createEnrollment(api.db, study.cohort, { status: 'expired' });
      await api.db.waitlistEntry.create({
        data: {
          cohortId: study.cohort.id,
          studentId: enrollment.studentId,
          status,
          joinedAt: NOW,
          offeredAt: NOW,
          enrollmentId: enrollment.id,
        },
      });
    }
    // The second student handed one task in late.
    await api.db.submission.create({
      data: {
        homeworkId: study.homework[0] ?? '',
        enrollmentId: second.enrollmentId,
        studentId: second.id,
        cohortId: study.cohort.id,
        status: 'submitted',
        body: 'late',
        submittedAt: NOW,
        isLate: true,
      },
    });
    await issueFor(api, study);

    const manager = (await signedIn(api, 'manager', study.school.id)).http;
    const url = `/api/manager/report?from=2026-01-01&to=2026-12-31`;
    const report = await manager.get(url);
    expect(report.body).toEqual({
      occupancy: {
        cohorts: 1,
        seatsTaken: 2,
        capacity: 2,
        byCourse: [
          {
            courseId: study.course.id,
            title: 'TypeScript',
            cohorts: 1,
            seatsTaken: 2,
            capacity: 2,
          },
        ],
      },
      money: [{ currency: 'UAH', paidMinor: 15_000, refundedMinor: 2_000 }],
      waitlist: { part: 1, total: 2 },
      homeworkOnTime: { part: 2, total: 3 },
      certificatesIssued: 1,
    });
    const outside = await manager.get('/api/manager/report?from=2025-01-01&to=2025-12-31');
    expect(outside.body).toMatchObject({
      occupancy: { cohorts: 0 },
      money: [],
      certificatesIssued: 0,
    });
    const euros = await manager.get(`${url}&currency=EUR`);
    expect(euros.body).toMatchObject({ money: [], occupancy: { cohorts: 0 } });
    const stranger = (await signedIn(api, 'manager', (await studyingCohort(api)).school.id)).http;
    const theirs = await stranger.get(`${url}&cohortId=${study.cohort.id}`);
    expect(theirs.body).toMatchObject({ money: [], occupancy: { cohorts: 0 } });
    for (const query of [
      '',
      'from=2026-02-01&to=2026-01-01',
      'from=2000-01-01&to=2026-01-01',
      'from=x&to=y',
    ]) {
      expectError(await manager.get(`/api/manager/report?${query}`), 'VALIDATION_FAILED');
    }
  });
});

describe('failed jobs', () => {
  it('are listed for their school only and retried exactly once', async () => {
    const mine = await studyingCohort(api);
    const failure = await api.db.jobFailure.create({
      data: {
        queue: 'certificates',
        jobId: mine.first.enrollmentId,
        schoolId: mine.school.id,
        payload: { enrollmentId: mine.first.enrollmentId },
        error: 'boom',
        attempts: 8,
        failedAt: NOW,
      },
    });
    const manager = (await signedIn(api, 'manager', mine.school.id)).http;
    const stranger = (await signedIn(api, 'manager', (await studyingCohort(api)).school.id)).http;
    expect((await manager.get('/api/manager/failed-jobs')).body).toMatchObject({
      total: 1,
      items: [{ id: failure.id, queue: 'certificates', attempts: 8 }],
    });
    expect((await stranger.get('/api/manager/failed-jobs')).body).toMatchObject({ total: 0 });
    const retry = (http: typeof manager) =>
      http.post(`/api/manager/failed-jobs/${failure.id}/retry`);
    expectError(await retry(stranger), 'NOT_FOUND');
    const replies = await Promise.all([retry(manager), retry(manager), retry(manager)]);
    expect(replies.map((r) => r.status).sort()).toEqual([204, 404, 404]);
    const queued = await api.deps.jobs
      .queue('certificates')
      .getJob(retryJob('certificates', failure.payload).id);
    expect(queued?.data).toEqual({ enrollmentId: mine.first.enrollmentId });
    expect((await manager.get('/api/manager/failed-jobs')).body).toMatchObject({ total: 0 });
  });
});

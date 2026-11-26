import { issueCertificate } from '@school/db/repo/certificate';
import { completeCohort } from '@school/db/repo/completion';
import { runUnit } from '@school/db/repo/unit-of-work';
import { type TestApi } from './app';
import { type studyingCohort } from './study';

/** Ends a cohort with all homework accepted and issues the first student's certificate. */
export const issueFor = async (api: TestApi, study: Awaited<ReturnType<typeof studyingCohort>>) => {
  const { first, cohort, homework } = study;
  await api.db.submission.createMany({
    data: homework.map((homeworkId) => ({
      homeworkId,
      enrollmentId: first.enrollmentId,
      studentId: first.id,
      cohortId: cohort.id,
      status: 'accepted',
      body: 'done',
      submittedAt: api.clock.now(),
      isLate: false,
    })),
  });
  const ends = new Date(api.clock.now().getTime() - 1_000);
  await api.db.cohort.update({ where: { id: cohort.id }, data: { endsAt: ends } });
  const unit = { now: api.clock.now(), timings: { holdTtlSec: 900, offerTtlSec: 86_400 } };
  await runUnit(api.db, unit, (u) => completeCohort(u, cohort.id));
  await runUnit(api.db, unit, (u) => issueCertificate(u, first.enrollmentId));
  return api.db.certificate.findUniqueOrThrow({ where: { enrollmentId: first.enrollmentId } });
};

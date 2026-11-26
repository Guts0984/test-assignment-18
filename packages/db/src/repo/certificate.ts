import { randomBytes } from 'node:crypto';
import { isCertificateEligible } from '@school/shared/certificate/eligibility';
import { type Unit } from './context';
import { emailStudent } from './outbox';

export type CertificateOutcome = 'issued' | 'already_issued' | 'not_eligible' | 'missing';

/** The next number of a course. The row lock makes issuers of one course take turns. */
const lockNextNumber = async (unit: Unit, courseId: string): Promise<number> => {
  await unit.tx.$executeRaw`
    INSERT INTO certificate_counters (course_id, last_number) VALUES (${courseId}::uuid, 0)
    ON CONFLICT (course_id) DO NOTHING`;
  const [row] = await unit.tx.$queryRaw<{ last_number: number }[]>`
    SELECT last_number FROM certificate_counters
     WHERE course_id = ${courseId}::uuid FOR UPDATE`;
  return (row?.last_number ?? 0) + 1;
};

/**
 * Issues the certificate of a completed enrollment that meets the condition. The number is
 * taken and used in one transaction, so a crash leaves neither a gap nor a duplicate.
 */
export const issueCertificate = async (
  unit: Unit,
  enrollmentId: string,
): Promise<CertificateOutcome> => {
  // The enrollment lock serializes with a review that is accepting homework right now.
  await unit.tx.$queryRaw`
    SELECT id FROM enrollments WHERE id = ${enrollmentId}::uuid FOR NO KEY UPDATE`;
  const enrollment = await unit.tx.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { cohort: { include: { course: true } }, certificate: true },
  });
  if (!enrollment) return 'missing';
  await unit.tx.enrollment.update({
    where: { id: enrollmentId },
    data: { certificateDueAt: null },
  });
  if (enrollment.certificate) return 'already_issued';
  const { cohort } = enrollment;
  const progress = {
    homeworkCount: await unit.tx.homework.count({ where: { cohortId: cohort.id } }),
    acceptedCount: await unit.tx.submission.count({
      where: { enrollmentId, status: 'accepted' },
    }),
    lastLessonEndsAt: cohort.endsAt,
  };
  if (enrollment.status !== 'completed' || !isCertificateEligible(progress, unit.now)) {
    return 'not_eligible';
  }
  await unit.tx.certificate.create({
    data: {
      courseId: cohort.courseId,
      enrollmentId,
      studentId: enrollment.studentId,
      number: await lockNextNumber(unit, cohort.courseId),
      verifyToken: randomBytes(32).toString('base64url'),
      issuedAt: unit.now,
    },
  });
  await emailStudent(unit, enrollment.studentId, {
    schoolId: cohort.schoolId,
    dedupeKey: `certificate:${enrollmentId}`,
    subject: `Your certificate: ${cohort.course.title}`,
    body: `You completed "${cohort.course.title}". Download the certificate from your account.`,
  });
  return 'issued';
};

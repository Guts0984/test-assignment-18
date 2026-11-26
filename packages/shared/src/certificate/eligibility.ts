export const CERTIFICATE_MIN_ACCEPTED_PERCENT = 80;

export type CertificateProgress = {
  readonly acceptedCount: number;
  readonly homeworkCount: number;
  /** Null when the cohort has no lessons. */
  readonly lastLessonEndsAt: Date | null;
};

export const meetsHomeworkThreshold = (accepted: number, total: number): boolean =>
  total > 0 && accepted * 100 >= total * CERTIFICATE_MIN_ACCEPTED_PERCENT;

export const isCertificateEligible = (progress: CertificateProgress, now: Date): boolean =>
  progress.lastLessonEndsAt !== null &&
  now >= progress.lastLessonEndsAt &&
  meetsHomeworkThreshold(progress.acceptedCount, progress.homeworkCount);

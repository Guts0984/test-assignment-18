/** The full data set at scale 1. */
const FULL = { students: 300_000, enrollments: 500_000, submissions: 1_000_000 } as const;
const FULL_COHORTS = 2_000;
const FULL_COURSES = 200;
const FULL_CERTIFICATES = 100_000;

export const SCHOOL_COUNT = 4;
export const LESSONS_PER_COHORT = 6;
export const NEAR_COHORTS = 6;
export const DST_COHORTS = 3;
export const SPECIAL_COHORTS = NEAR_COHORTS + DST_COHORTS;

export type SeedSizes = {
  readonly students: number;
  readonly courses: number;
  readonly cohorts: number;
  /** Cohorts generated in bulk; the rest are hand-shaped. */
  readonly bulkCohorts: number;
  readonly enrollmentsPerCohort: number;
  readonly mentorsPerSchool: number;
  readonly submissions: number;
  readonly certificates: number;
};

const MIN_SCALE = 0.005;

export const seedSizes = (scale: number): SeedSizes => {
  if (!(scale >= MIN_SCALE && scale <= 1)) {
    throw new RangeError(`SEED_SCALE must be between ${MIN_SCALE} and 1`);
  }
  const scaled = (value: number) => Math.round(value * scale);
  const courses = Math.max(2 * SCHOOL_COUNT, scaled(FULL_COURSES));
  const cohorts = Math.max(courses * 8 + SPECIAL_COHORTS, scaled(FULL_COHORTS));
  const bulkCohorts = cohorts - SPECIAL_COHORTS;
  return {
    students: scaled(FULL.students),
    courses,
    cohorts,
    bulkCohorts,
    enrollmentsPerCohort: Math.ceil(scaled(FULL.enrollments) / bulkCohorts),
    mentorsPerSchool: Math.max(3, scaled(25)),
    submissions: scaled(FULL.submissions),
    certificates: scaled(FULL_CERTIFICATES),
  };
};

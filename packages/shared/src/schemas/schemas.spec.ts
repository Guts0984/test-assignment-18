import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from './auth';
import { catalogQuerySchema } from './catalog';
import { createCohortSchema, updateCohortSchema } from './manage';
import { updateStaffSchema } from './staff';

const cohort = {
  courseId: '018f6f1e-7b1a-7c3e-9d6a-111111111111',
  mentorId: '018f6f1e-7b1a-7c3e-9d6a-222222222222',
  startDate: '2026-09-01',
  timeZone: 'Europe/Kyiv',
  capacity: 10,
  priceMinor: 1_000,
  currency: 'UAH',
  schedule: { weekdays: [2, 4], localTime: '19:00', count: 12 },
};

describe('input schemas', () => {
  it('normalises e-mail addresses', () => {
    expect(loginSchema.parse({ email: '  A@Example.TEST ', password: 'x' }).email).toBe(
      'a@example.test',
    );
  });

  it.each([
    { role: 'admin' },
    { schoolId: cohort.courseId },
    { id: cohort.courseId },
    { fullName: `bad${String.fromCharCode(0)}name` },
    { password: 'short' },
    { email: 'not-an-address' },
  ])('refuses a registration with %o', (extra) => {
    const valid = {
      email: 'a@example.test',
      password: 'long-enough-password',
      fullName: 'Anna',
      timeZone: 'Europe/Kyiv',
    };
    expect(registerSchema.safeParse(valid).success).toBe(true);
    expect(registerSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
  });

  it.each([
    { capacity: 0 },
    { capacity: -1 },
    { capacity: 1.5 },
    { priceMinor: 10.5 },
    { priceMinor: -100 },
    { priceMinor: '100' },
    { currency: 'BTC' },
    { startDate: '0000-01-01' },
    { startDate: '2026-02-30' },
    { timeZone: 'UTC+3' },
    { seatsTaken: 0 },
    { schoolId: cohort.courseId },
  ])('refuses a cohort with %o', (override) => {
    expect(createCohortSchema.safeParse(cohort).success).toBe(true);
    expect(createCohortSchema.safeParse({ ...cohort, ...override }).success).toBe(false);
  });

  it('refuses empty and over-reaching updates', () => {
    expect(updateCohortSchema.safeParse({}).success).toBe(false);
    expect(updateCohortSchema.safeParse({ capacity: 1 }).success).toBe(false);
    expect(updateStaffSchema.safeParse({}).success).toBe(false);
    expect(updateStaffSchema.safeParse({ role: 'admin' }).success).toBe(false);
  });

  it('needs a currency before comparing prices', () => {
    expect(catalogQuerySchema.safeParse({ priceMin: '10' }).success).toBe(false);
    expect(catalogQuerySchema.parse({ priceMin: '10', currency: 'EUR' }).priceMin).toBe(10);
    expect(catalogQuerySchema.safeParse({ page: '1e9' }).success).toBe(false);
    expect(catalogQuerySchema.safeParse({ pageSize: '100000' }).success).toBe(false);
  });
});

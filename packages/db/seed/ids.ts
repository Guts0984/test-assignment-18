import { createHash } from 'node:crypto';

/** Deterministic ids, equal to `md5(name)::uuid` in SQL, so inserts can refer to each other. */
export const seedId = (name: string): string => {
  const hex = createHash('md5').update(name).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const DEMO_LOGINS = {
  admin: (school: number) => `admin@school${school}.example.test`,
  manager: (school: number) => `manager@school${school}.example.test`,
  mentor: (school: number, mentor: number) => `mentor${mentor}@school${school}.example.test`,
  student: (student: number) => `student${student}@students.example.test`,
} as const;

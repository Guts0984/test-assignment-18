import { createHash } from 'node:crypto';

/**
 * Deterministic ids, so inserts can refer to each other. They are well-formed version 4 UUIDs
 * (the API rejects anything else); `SEED_UUID_FUNCTION` computes the same value in SQL.
 */
export const seedId = (name: string): string => {
  const hex = createHash('md5').update(name).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20),
  ].join('-');
};

/** Temporary, so it exists only for the seeding session. */
export const SEED_UUID_FUNCTION = `
  CREATE OR REPLACE FUNCTION pg_temp.seed_uuid(name text) RETURNS uuid
  LANGUAGE sql IMMUTABLE AS
  $$ SELECT overlay(overlay(md5(name) placing '4' from 13) placing '8' from 17)::uuid $$`;

export const DEMO_LOGINS = {
  admin: (school: number) => `admin@school${school}.example.test`,
  manager: (school: number) => `manager@school${school}.example.test`,
  mentor: (school: number, mentor: number) => `mentor${mentor}@school${school}.example.test`,
  student: (student: number) => `student${student}@students.example.test`,
} as const;

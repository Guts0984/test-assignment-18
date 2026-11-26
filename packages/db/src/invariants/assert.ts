import { type Db } from '../client';
import { INVARIANT_QUERIES, type InvariantName } from './queries';

export type Violation = {
  readonly invariant: InvariantName;
  readonly count: number;
  readonly sample: readonly unknown[];
};

const SAMPLE = 5;

export const findViolations = async (db: Db): Promise<readonly Violation[]> => {
  const violations: Violation[] = [];
  const entries = Object.entries(INVARIANT_QUERIES) as [InvariantName, string][];
  for (const [invariant, query] of entries) {
    // The queries are constants above; no input reaches them.
    const rows = await db.$queryRawUnsafe<unknown[]>(query);
    if (rows.length > 0) {
      violations.push({ invariant, count: rows.length, sample: rows.slice(0, SAMPLE) });
    }
  }
  return violations;
};

export const assertInvariants = async (db: Db): Promise<void> => {
  const violations = await findViolations(db);
  if (violations.length > 0) {
    throw new Error(`Invariants broken: ${JSON.stringify(violations, null, 2)}`);
  }
};

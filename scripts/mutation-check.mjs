// Proves the security and concurrency tests can fail: disables one protection at a time, runs
// the tests that guard it, expects them to fail, and restores the file. Writes the results to
// docs/SECURITY-TESTS.md. Needs Postgres and Redis (docker compose up postgres redis mailpit).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';

const MUTATIONS = [
  {
    protection: 'Login rate limiter',
    change: 'the limiter guard lets everything through',
    file: 'apps/api/src/common/rate-limit/rate-limit.guard.ts',
    from: 'if (!env.RATE_LIMIT_ENABLED) return true;',
    to: 'if (env) return true;',
    test: 'apps/api/test/adv/limiter.adv.spec.ts',
  },
  {
    protection: 'Authentication and role guard',
    change: 'the global auth guard lets everything through',
    file: 'apps/api/src/common/auth/auth.guard.ts',
    from: 'const targets = [context.getHandler(), context.getClass()];',
    to: 'const targets = [context.getHandler(), context.getClass()];\n    if (targets) return true;',
    test: 'apps/api/test/adv/route-sweep.adv.spec.ts',
  },
  {
    protection: 'Input validator (strict booking body)',
    change: 'unknown fields are accepted when booking',
    file: 'packages/shared/src/schemas/enrollment.ts',
    from: 'export const holdSeatSchema = z.strictObject({',
    to: 'export const holdSeatSchema = z.object({',
    test: 'apps/api/test/adv/idor.adv.spec.ts',
  },
  {
    protection: 'Seat row lock',
    change: 'cohort rows are read without FOR NO KEY UPDATE',
    file: 'packages/db/src/repo/locks.ts',
    from: 'WHERE id = ${id}::uuid FOR NO KEY UPDATE`;\n  }',
    to: 'WHERE id = ${id}::uuid`;\n  }',
    test: 'apps/api/test/adv/last-seats.race.adv.spec.ts',
  },
  {
    protection: 'Seat capacity constraint',
    change: 'the CHECK seats_taken <= capacity is removed',
    file: 'packages/db/prisma/migrations/0002_guards/migration.sql',
    from: 'CHECK (seats_taken >= 0 AND seats_taken <= capacity),',
    to: 'CHECK (seats_taken >= 0),',
    test: 'packages/db/test/constraints.it.spec.ts',
  },
  {
    protection: 'One refund per enrollment (unique index)',
    change: 'the partial unique index is not unique',
    file: 'packages/db/prisma/migrations/0002_guards/migration.sql',
    from: 'CREATE UNIQUE INDEX refund_requests_one_per_enrollment_idx',
    to: 'CREATE INDEX refund_requests_one_per_enrollment_idx',
    test: 'packages/db/test/ledger.it.spec.ts',
  },
  {
    protection: 'Payment notification signature',
    change: 'every signature is accepted',
    file: 'apps/api/src/modules/payments/webhook.service.ts',
    from: 'if (!authentic) throw refuse();',
    to: 'void authentic;',
    test: 'apps/api/test/adv/webhook.adv.spec.ts',
  },
];

const run = (command, args) =>
  spawnSync(command, args, { encoding: 'utf8', maxBuffer: 50_000_000 });

const build = () => {
  if (run('pnpm', ['run', 'build:libs']).status !== 0) throw new Error('build failed');
};

const rows = [];
for (const mutation of MUTATIONS) {
  const original = readFileSync(mutation.file, 'utf8');
  if (!original.includes(mutation.from)) {
    throw new Error(`The code of "${mutation.protection}" moved: update the mutation`);
  }
  let outcome;
  try {
    writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));
    build();
    outcome = run('pnpm', ['exec', 'vitest', 'run', mutation.test]);
  } finally {
    writeFileSync(mutation.file, original);
  }
  const summary = /Tests\s+(.*)/.exec(stripVTControlCharacters(outcome.stdout))?.[1] ?? '';
  const caught = outcome.status !== 0 && summary.includes('failed');
  process.stdout.write(`${caught ? 'caught' : 'MISSED'}: ${mutation.protection} — ${summary}\n`);
  rows.push({ ...mutation, caught, summary });
}
build();

const REPORT = 'docs/SECURITY-TESTS.md';
const START = '<!-- mutation:start -->';
const END = '<!-- mutation:end -->';
const report = readFileSync(REPORT, 'utf8');
const results = `| Protection disabled | Change | Test run | Result with the protection off | Caught |
|---|---|---|---|---|
${rows
  .map(
    (r) =>
      `| ${r.protection} | ${r.change} | \`${r.test}\` | ${r.summary.replaceAll('|', '\\|')} | ${r.caught ? 'yes' : '**no**'} |`,
  )
  .join('\n')}`;
writeFileSync(
  REPORT,
  `${report.slice(0, report.indexOf(START) + START.length)}\n\n${results}\n\n${report.slice(report.indexOf(END))}`,
);
process.exit(rows.every((row) => row.caught) ? 0 : 1);

// Keeps the README equal to the code. `--write` regenerates the marked blocks; without it the
// script fails when a block differs, a required section is missing, or a decision of plan.md
// is not in the README.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DATABASE_OBJECTS } from './database-docs.mjs';

const require = createRequire(import.meta.url);
const { ENROLLMENT_TRANSITIONS } = require('@school/shared/status/enrollment');
const { SUBMISSION_TRANSITIONS } = require('@school/shared/status/submission');
const { QUEUES } = require('@school/shared/jobs/registry');

const table = (headers, rows) =>
  [headers, headers.map(() => '---'), ...rows]
    .map((cells) => `| ${cells.map((c) => String(c).replaceAll('|', '\\|')).join(' | ')} |`)
    .join('\n');

const transitions = (rows) =>
  table(
    ['From', 'To', 'Who', 'When'],
    rows.map((r) => [
      r.from ? `\`${r.from}\`` : '(new)',
      `\`${r.to}\``,
      r.actors.join(', '),
      r.when,
    ]),
  );

/** Names of the objects that exist after all migrations have run. */
const databaseObjects = () => {
  const root = 'packages/db/prisma/migrations';
  const sql = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(`${root}/${entry.name}/migration.sql`, 'utf8'))
    .join('\n');
  const found = { unique: new Set(), check: new Set(), trigger: new Set(), index: new Set() };
  const names = (pattern) => [...sql.matchAll(pattern)].map((match) => match[1]);
  for (const name of names(/CREATE UNIQUE INDEX "?(\w+)"?/g)) found.unique.add(name);
  for (const name of names(/CREATE INDEX "?(\w+)"?/g)) found.index.add(name);
  for (const name of names(/CONSTRAINT "?(\w+_check)"?\s+CHECK/g)) found.check.add(name);
  for (const name of names(/CREATE (?:CONSTRAINT )?TRIGGER (\w+)/g)) found.trigger.add(name);
  for (const name of names(/DROP INDEX "?(\w+)"?/g)) found.index.delete(name);
  return found;
};

const database = () => {
  const found = databaseObjects();
  const problems = [];
  const sections = [
    ['unique', 'Unique constraints and unique indexes'],
    ['check', 'CHECK constraints'],
    ['trigger', 'Triggers'],
    ['index', 'Indexes for queries'],
  ].map(([kind, title]) => {
    const described = DATABASE_OBJECTS[kind];
    for (const name of found[kind]) {
      if (!described[name]) problems.push(`${kind} ${name} is not described`);
    }
    for (const name of Object.keys(described)) {
      if (!found[kind].has(name)) problems.push(`${kind} ${name} is described but does not exist`);
    }
    const rows = Object.entries(described).map(([name, text]) => [`\`${name}\``, text]);
    return `### ${title}\n\n${table(['Name', 'Purpose'], rows)}`;
  });
  if (problems.length > 0) throw new Error(problems.join('\n'));
  return `${sections.join('\n\n')}\n\nPrimary keys and foreign keys are defined in the Prisma schema.`;
};

/** The assumptions of plan.md are the decisions the README has to report. */
const decisions = () => {
  const plan = readFileSync('plan.md', 'utf8');
  const start = plan.indexOf('## 3. Assumptions');
  const end = plan.indexOf('## 4. Architecture');
  return plan
    .slice(plan.indexOf('\n', start), end)
    .replace(/\n---\s*$/, '')
    .trim();
};

const BLOCKS = {
  'enrollment-transitions': () => transitions(ENROLLMENT_TRANSITIONS),
  'submission-transitions': () => transitions(SUBMISSION_TRANSITIONS),
  jobs: () =>
    table(
      ['Queue', 'When a job is queued', 'Protection against running twice'],
      Object.entries(QUEUES).map(([name, q]) => [`\`${name}\``, q.enqueued, q.dedup]),
    ),
  database,
  decisions,
};

const SECTIONS = [
  'Running it',
  'Tests',
  'Logins',
  'Seats: how they are counted and why they cannot be oversold',
  'Holds, payments, refunds and transfers under concurrency and retries',
  'Schedule, reminders and deadlines across time zones',
  'Background jobs',
  'Status tables',
  'Database indexes and constraints',
  'Decisions',
];

const original = readFileSync('README.md', 'utf8');
let readme = original;
const problems = [];
for (const [name, render] of Object.entries(BLOCKS)) {
  const open = `<!-- generated:${name} -->`;
  const close = `<!-- /generated:${name} -->`;
  const from = readme.indexOf(open);
  const to = readme.indexOf(close);
  if (from < 0 || to < from) {
    problems.push(`The README has no ${name} block`);
    continue;
  }
  readme = `${readme.slice(0, from + open.length)}\n\n${render()}\n\n${readme.slice(to)}`;
}
for (const section of SECTIONS) {
  if (!original.includes(`\n## ${section}\n`)) problems.push(`Missing section: ${section}`);
}

if (process.argv.includes('--write')) writeFileSync('README.md', readme);
else if (readme !== original) {
  problems.push('Generated blocks are out of date: run `pnpm run readme`');
}
if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('README matches the code.\n');

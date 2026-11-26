// Runs all acceptance checks of the assignment and writes docs/ACCEPTANCE.md.
// Starts the stack twice: once exactly as the assignment says (A-1, A-16 speed), then with the
// test profile (movable clock) for the behaviour checks.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const results = new Map();
const record = (id, passed, evidence, seconds) => {
  const previous = results.get(id);
  results.set(id, {
    passed: passed && (previous?.passed ?? true),
    evidence: previous ? `${previous.evidence}; ${evidence}` : evidence,
    seconds: seconds + (previous?.seconds ?? 0),
  });
};

const run = (command, args, env = {}) => {
  const started = Date.now();
  const done = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  return { passed: done.status === 0, seconds: Math.round((Date.now() - started) / 1000) };
};

/** Runs Vitest against the stack and records every test named "A-n …". */
const stackTests = (path, env, fallbackId) => {
  const report = join(tmpdir(), `acceptance-${results.size}-${Date.now()}.json`);
  const outcome = run(
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      '-c',
      'vitest.stack.config.ts',
      path,
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${report}`,
    ],
    env,
  );
  const data = JSON.parse(readFileSync(report, 'utf8'));
  for (const file of data.testResults) {
    for (const test of file.assertionResults) {
      const id = /A-\d+/.exec(test.fullName)?.[0] ?? fallbackId;
      if (id) {
        record(
          id,
          test.status === 'passed',
          test.title.replace(/^A-\d+ /, ''),
          Math.round((test.duration ?? 0) / 1000),
        );
      }
    }
  }
  return outcome;
};

const compose = [
  'compose',
  '--env-file',
  '.env.test',
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.test.yml',
];

// --- As shipped ---------------------------------------------------------------------------
const up = run('./scripts/acceptance/compose-up.sh', []);
record('A-1', up.passed, 'clean `cp .env.example .env && docker compose up --build`', up.seconds);
const speed = stackTests('tests/perf', { ENV_FILE: '.env' });
record('A-16', speed.passed, 'latency budgets on the full seed', 0);

// --- Test profile -------------------------------------------------------------------------
run('./scripts/env-test.sh', ['.env.test'], { SEED_SCALE: '1' });
run(
  'docker',
  [...compose, 'up', '--detach', '--wait', '--wait-timeout', '900', '--force-recreate'],
  { ENV_FILE: '.env.test' },
);
stackTests('tests/acceptance', {});
stackTests('tests/cross-stack', {});
const e2e = run('pnpm', ['exec', 'playwright', 'test']);
record('A-16', e2e.passed, 'Playwright: reload and Back keep the filters', 0);
stackTests('tests/reconcile', {});

// --- Repository checks --------------------------------------------------------------------
const checks = ['typecheck', 'lint', 'gen:client', 'test'].map((script) => ({
  script,
  ...run('pnpm', ['run', script]),
}));
const drift = run('git', [
  'diff',
  '--exit-code',
  '--',
  'apps/api/openapi.json',
  'apps/web/src/shared/api/generated',
]);
record(
  'A-2',
  checks.every((c) => c.passed) && drift.passed,
  `${checks.map((c) => `${c.script} ${c.passed ? 'ok' : 'failed'}`).join(', ')}, client ${drift.passed ? 'unchanged' : 'changed'}; CI runs the same on every commit`,
  checks.reduce((sum, c) => sum + c.seconds, 0),
);
const readme = run('node', ['scripts/readme.mjs']);
record('A-17', readme.passed, 'README sections, transition tables, jobs, indexes', readme.seconds);

const ids = Array.from({ length: 17 }, (_, i) => `A-${i + 1}`);
const rows = ids.map((id) => {
  const result = results.get(id);
  const state = !result ? 'not run' : result.passed ? 'pass' : 'FAIL';
  return `| ${id} | ${state} | ${result?.seconds ?? 0} | ${(result?.evidence ?? '').replaceAll('|', '\\|')} |`;
});
writeFileSync(
  'docs/ACCEPTANCE.md',
  `# Acceptance results

Produced by \`node scripts/acceptance/run.mjs\` on ${new Date().toISOString().slice(0, 16)}Z
against the docker compose stack with the full seed.

| Check | Result | Seconds | Evidence |
|---|---|---|---|
${rows.join('\n')}
`,
);
const failed = ids.filter((id) => !results.get(id)?.passed);
process.stdout.write(failed.length ? `Not passing: ${failed.join(', ')}\n` : 'All 17 pass.\n');
process.exit(failed.length ? 1 : 0);

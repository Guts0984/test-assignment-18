// Fails when source code that ships imports a package that is not a runtime dependency. Such a
// package is present during development and missing from the pruned production image.
import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';

const PACKAGES = ['apps/api', 'apps/worker', 'apps/paystub', 'apps/web'].concat(
  readdirSync('packages').map((name) => `packages/${name}`),
);
/** Folders whose code is only ever run by tests. */
const TEST_ONLY = /(\.spec\.tsx?$|\/testing\/)/;
const IMPORT =
  /(?:from\s+|import\s*\(\s*|require\.resolve\(\s*|requireFrom\.resolve\(\s*)'([^'.][^']*)'/g;

const sources = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !TEST_ONLY.test(path) ? [path] : [];
  });

const packageOf = (specifier) =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');

const problems = [];
for (const root of PACKAGES) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const declared = new Set(Object.keys(manifest.dependencies ?? {}));
  const folders = root === 'packages/db' ? ['src', 'seed'] : ['src'];
  for (const file of folders.flatMap((folder) => sources(join(root, folder)))) {
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const name = packageOf(specifier);
      const local = specifier.startsWith('@/') || specifier.startsWith('node:');
      if (!local && !builtinModules.includes(name) && !declared.has(name)) {
        problems.push(`${file}: ${name} is not in the dependencies of ${manifest.name}`);
      }
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`${[...new Set(problems)].join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('Every shipped import is a runtime dependency.\n');

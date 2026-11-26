import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createDb, type Db } from '../client';

const TEMPLATE = 'school_test_template';

const withDatabase = (url: string, database: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
};

const onServer = async (url: string, statement: string): Promise<void> => {
  const admin = createDb(withDatabase(url, 'postgres'));
  try {
    // Database names are generated here, never taken from input.
    await admin.$executeRawUnsafe(statement);
  } finally {
    await admin.$disconnect();
  }
};

/** Works from the sources and from the build output alike. */
const findPackageRoot = (directory: string): string => {
  if (existsSync(join(directory, 'prisma', 'schema.prisma'))) return directory;
  const parent = dirname(directory);
  if (parent === directory) throw new Error('The database package root was not found');
  return findPackageRoot(parent);
};

export const migrate = async (url: string): Promise<void> => {
  const packageRoot = findPackageRoot(__dirname);
  const requireFrom = createRequire(join(packageRoot, 'package.json'));
  const cli = requireFrom.resolve('prisma/build/index.js');
  await promisify(execFile)(process.execPath, [cli, 'migrate', 'deploy'], {
    cwd: packageRoot,
    env: { DATABASE_URL: url, CHECKPOINT_DISABLE: '1', NODE_ENV: 'test' },
  });
};

/** Migrates one template database that every test database is copied from. */
export const createTemplateDatabase = async (serverUrl: string): Promise<void> => {
  await onServer(serverUrl, `DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`);
  await onServer(serverUrl, `CREATE DATABASE ${TEMPLATE}`);
  await migrate(withDatabase(serverUrl, TEMPLATE));
};

export type TestDatabase = {
  readonly db: Db;
  readonly url: string;
  readonly drop: () => Promise<void>;
};

/** A private, migrated database, so test files can run in parallel. */
export const createTestDatabase = async (
  serverUrl: string,
  connections = 20,
): Promise<TestDatabase> => {
  const name = `t_${randomBytes(8).toString('hex')}`;
  await onServer(serverUrl, `CREATE DATABASE ${name} TEMPLATE ${TEMPLATE}`);
  const parsed = new URL(withDatabase(serverUrl, name));
  parsed.searchParams.set('connection_limit', String(connections));
  const url = parsed.toString();
  const db = createDb(url);
  return {
    db,
    url,
    drop: async () => {
      await db.$disconnect();
      await onServer(serverUrl, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    },
  };
};

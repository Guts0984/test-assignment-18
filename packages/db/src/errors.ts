import { Prisma } from '@prisma/client';

const RAW_QUERY_FAILED = 'P2010';
const UNIQUE_FAILED = 'P2002';
const WRITE_CONFLICT = 'P2034';

export const SQLSTATE = {
  uniqueViolation: '23505',
  checkViolation: '23514',
  restrictViolation: '23001',
  foreignKeyViolation: '23503',
  serializationFailure: '40001',
  deadlock: '40P01',
} as const;

/** The PostgreSQL error code behind a Prisma error, when there is one. */
export const sqlStateOf = (error: unknown): string | undefined => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === UNIQUE_FAILED) return SQLSTATE.uniqueViolation;
    if (error.code === WRITE_CONFLICT) return SQLSTATE.serializationFailure;
    if (error.code === RAW_QUERY_FAILED && typeof error.meta?.['code'] === 'string') {
      return error.meta['code'];
    }
    return undefined;
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return /code: "([0-9A-Z]{5})"/.exec(error.message)?.[1];
  }
  return undefined;
};

export const isUniqueViolation = (error: unknown): boolean =>
  sqlStateOf(error) === SQLSTATE.uniqueViolation;

export const isTransientConflict = (error: unknown): boolean => {
  const state = sqlStateOf(error);
  return state === SQLSTATE.deadlock || state === SQLSTATE.serializationFailure;
};

/** Prisma's codes for "the database cannot be reached or did not answer". */
const UNREACHABLE = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);
/** PostgreSQL's classes for lost connections, shutdown and exhausted connections. */
const UNAVAILABLE_STATE = /^(08...|57P0[123]|53300)$/;
const UNAVAILABLE_TEXT =
  /can't reach database server|server has closed the connection|connection (reset|refused|closed|terminated)|terminating connection|timed out fetching a new connection|database system is (shutting down|starting up|in recovery)/i;

export const isDatabaseUnavailable = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError && UNREACHABLE.has(error.code)) {
    return true;
  }
  const state = sqlStateOf(error);
  if (state !== undefined) return UNAVAILABLE_STATE.test(state);
  const fromPrisma =
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError;
  return fromPrisma && UNAVAILABLE_TEXT.test(error.message);
};

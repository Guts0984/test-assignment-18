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

import { Prisma, PrismaClient } from '@prisma/client';

export type Db = PrismaClient;
/** A transaction handle. Every function that locks rows takes one, never the client. */
export type Tx = Prisma.TransactionClient;

export const createDb = (url: string): Db =>
  new PrismaClient({ datasourceUrl: url, errorFormat: 'minimal' });

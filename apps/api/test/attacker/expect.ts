import { apiErrorSchema, statusForCode, type ErrorCode } from '@school/shared/errors/api-error';
import { expect } from 'vitest';
import { type Reply } from './client';

const LEAKS = /\bat \S+ \(|node_modules|SELECT |INSERT |prisma|ECONN|stack/i;

/** Every failure has the shared shape, the right status and nothing internal. */
export const expectError = (reply: Reply, code: ErrorCode): void => {
  expect({ status: reply.status, body: reply.body }).toMatchObject({
    status: statusForCode(code),
    body: { code },
  });
  expect(apiErrorSchema.strict().safeParse(reply.body).success).toBe(true);
  expect(reply.text).not.toMatch(LEAKS);
};

import { signAccessToken } from '../../src/common/auth/access-token';
import { ACCESS_COOKIE } from '../../src/common/auth/session';
import { type TestApi } from './app';
import { client, type Client } from './client';
import { createUser } from '@school/db/testing/factories';

export type Student = { readonly id: string; readonly http: Client };

const sessionFor = async (api: TestApi, userId: string, url: string): Promise<Client> => {
  const http = client(url);
  const { JWT_ACCESS_SECRET: secret } = api.deps.env;
  http.cookies.set(
    ACCESS_COOKIE,
    await signAccessToken(userId, { secret, ttlSec: 900, now: new Date() }),
  );
  return http;
};

/** Many signed-in students at once, spread evenly over the api copies. */
export const students = async (api: TestApi, count: number): Promise<Student[]> => {
  const created: Student[] = [];
  for (let start = 0; start < count; start += 20) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(20, count - start) }, async (_, i) => {
        const user = await createUser(api.db);
        const copy = api.copies[(start + i) % api.copies.length];
        return { id: user.id, http: await sessionFor(api, user.id, copy?.url ?? api.url) };
      }),
    );
    created.push(...batch);
  }
  return created;
};

export const student = async (api: TestApi): Promise<Student> => {
  const [one] = await students(api, 1);
  if (!one) throw new Error('No student was created');
  return one;
};

/** A client for an account that already exists, on a chosen copy. */
export const signInAs = (api: TestApi, userId: string, url: string = api.url): Promise<Client> =>
  sessionFor(api, userId, url);

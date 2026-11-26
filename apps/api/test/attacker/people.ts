import { hashPassword } from '@school/db/password';
import { createSchool, createUser } from '@school/db/testing/factories';
import { type Role } from '@school/shared/status/actors';
import { type TestApi } from './app';
import { client } from './client';

export const PASSWORD = 'correct-horse-battery';
let hashed: Promise<string> | undefined;
const passwordHash = () => (hashed ??= hashPassword(PASSWORD));

export const createAccount = async (api: TestApi, role: Role, schoolId?: string) =>
  createUser(api.db, {
    role,
    ...(schoolId ? { schoolId } : {}),
    passwordHash: await passwordHash(),
  });

/** A signed-in client for a new account. */
export const signedIn = async (
  api: TestApi,
  role: Role,
  schoolId?: string,
  baseUrl: string = api.url,
) => {
  const user = await createAccount(api, role, schoolId);
  const http = client(baseUrl);
  const reply = await http.post('/api/auth/login', { email: user.email, password: PASSWORD });
  if (reply.status !== 200) throw new Error(`login failed: ${reply.status} ${reply.text}`);
  return { user, http };
};

/** A school with one signed-in account of each staff role. */
export const staffedSchool = async (api: TestApi) => {
  const school = await createSchool(api.db);
  const [admin, manager, mentor] = await Promise.all([
    signedIn(api, 'admin', school.id),
    signedIn(api, 'manager', school.id),
    signedIn(api, 'mentor', school.id),
  ]);
  return { school, admin, manager, mentor };
};

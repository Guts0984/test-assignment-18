import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { createDb, type Db } from '@school/db/client';
import { findViolations } from '@school/db/invariants/assert';
import { hashPassword } from '@school/db/password';
import { createCohortWithSchedule } from '@school/db/repo/cohort-schedule';
import { SYSTEM_ACTOR } from '@school/db/repo/seat-journal';
import { createSharedTestTime } from '@school/db/time';
import { inTransaction } from '@school/db/transaction';
import { sign, SIGNATURE_HEADER } from '@school/gateway/signature';
import { seal } from '@school/gateway/secret-box';
import { addDays } from '@school/shared/schedule/zoned';
import { client, type Client, type Reply } from '../../apps/api/test/attacker/client';
import { signAccessToken } from '../../apps/api/src/common/auth/access-token';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing: run scripts/env-test.sh and start the stack`);
  return value;
};

/** Addresses of the running compose stack. */
export const URLS = {
  public: `http://localhost:${process.env['HTTP_PORT'] ?? '8080'}`,
  api: [`http://127.0.0.1:3001`, `http://127.0.0.1:3002`] as const,
  mail: () => process.env['MAILPIT_API_URL'] ?? 'http://127.0.0.1:8025',
};

export const PASSWORD = 'stack-test-password-1';

let database: Db | undefined;
export const db = (): Db => (database ??= createDb(required('DATABASE_URL')));

export const until = async <T>(
  probe: () => Promise<T>,
  what: string,
  timeoutMs = 60_000,
): Promise<NonNullable<T>> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
};

/** Moves the business clock of every process in the stack. */
export const setClock = async (instant: Date): Promise<void> => {
  const reply = await client(URLS.public).post(
    '/api/__test/clock',
    { now: instant.toISOString() },
    { headers: { 'x-test-token': required('TEST_CONTROL_TOKEN') } },
  );
  if (reply.status !== 200) throw new Error(`clock not moved: ${reply.status} ${reply.text}`);
};

export const resetClock = (): Promise<void> => setClock(new Date());
export const now = (): Promise<Date> => createSharedTestTime(db()).now();

const compose = async (...args: string[]): Promise<string> => {
  const { stdout } = await promisify(execFile)(
    'docker',
    [
      'compose',
      '--env-file',
      required('ENV_FILE'),
      '-f',
      'docker-compose.yml',
      '-f',
      'docker-compose.test.yml',
      ...args,
    ],
    { maxBuffer: 10_000_000 },
  );
  return stdout;
};

export const workers = {
  stop: () => compose('stop', 'worker'),
  /** `kill -9` on every worker container. */
  kill: () => compose('kill', '--signal', 'KILL', 'worker'),
  start: (copies = 1) =>
    compose(
      'up',
      '--detach',
      '--no-recreate',
      '--no-deps',
      '--scale',
      `worker=${copies}`,
      'worker',
    ),
  running: async () =>
    (await compose('ps', '--status', 'running', '--quiet', 'worker'))
      .trim()
      .split('\n')
      .filter(Boolean).length,
};

export const flushAll = () => compose('exec', '-T', 'redis', 'redis-cli', 'FLUSHALL');

export const stubControl = async (change: Record<string, unknown>): Promise<void> => {
  const reply = await client(URLS.public).post('/paystub/control', change, {
    headers: { 'x-test-token': required('TEST_CONTROL_TOKEN') },
  });
  if (reply.status !== 200) throw new Error(`stub control failed: ${reply.status}`);
};

export const gatewayRefunds = async (orderIds: readonly string[]) => {
  const reply = await client(URLS.public).get('/paystub/api/transactions');
  const body = reply.body as { refunds: { order_id: string; amount_minor: string }[] };
  return body.refunds.filter((refund) => orderIds.includes(refund.order_id));
};

export type Person = { readonly id: string; readonly email: string; readonly http: Client };

const sessionFor = async (userId: string, url: string): Promise<Client> => {
  const http = client(url);
  http.cookies.set(
    'access_token',
    await signAccessToken(userId, {
      secret: required('JWT_ACCESS_SECRET'),
      ttlSec: 900,
      now: new Date(),
    }),
  );
  return http;
};

let hashed: Promise<string> | undefined;

export const person = async (
  role: 'student' | 'mentor' | 'manager' | 'admin',
  schoolId: string | null,
  options: { readonly url?: string; readonly name?: string } = {},
): Promise<Person> => {
  const id = randomUUID();
  const email = `${role}-${id}@stack.example.test`;
  await db().user.create({
    data: {
      id,
      email,
      role,
      schoolId,
      fullName: options.name ?? `Stack ${role} ${id.slice(0, 6)}`,
      passwordHash: await (hashed ??= hashPassword(PASSWORD)),
    },
  });
  return { id, email, http: await sessionFor(id, options.url ?? URLS.public) };
};

export const people = async (count: number): Promise<Person[]> => {
  const created: Person[] = [];
  for (let start = 0; start < count; start += 20) {
    created.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(20, count - start) }, () => person('student', null)),
      )),
    );
  }
  return created;
};

export const again = (who: Person, url: string): Promise<Client> => sessionFor(who.id, url);

/** A new school with its staff, connected to the stack's payment stub. */
export const school = async () => {
  const row = await db().school.create({ data: { name: `Stack school ${randomUUID()}` } });
  const [manager, mentor] = await Promise.all([
    person('manager', row.id),
    person('mentor', row.id),
  ]);
  const key = required('PAYSTUB_MERCHANT_KEY');
  await db().gatewayConfig.create({
    data: {
      schoolId: row.id,
      baseUrl: process.env['PAYSTUB_INTERNAL_URL'] ?? 'http://paystub:4000',
      keyCiphertext: seal(key, required('GATEWAY_ENCRYPTION_KEY')),
      keyLast4: key.slice(-4),
      updatedAt: new Date(),
    },
  });
  const course = await db().course.create({
    data: {
      schoolId: row.id,
      title: `Stack course ${row.id.slice(0, 8)}`,
      direction: 'programming',
    },
  });
  return { id: row.id, course, manager, mentor };
};

export type School = Awaited<ReturnType<typeof school>>;

/** A cohort with real lessons, starting `startsInDays` after the current business date. */
export const cohort = async (
  owner: School,
  options: {
    readonly capacity?: number;
    readonly priceMinor?: number;
    readonly startsInDays?: number;
    readonly startDate?: string;
    readonly lessons?: number;
    readonly timeZone?: string;
    readonly localTime?: string;
    readonly weekdays?: readonly number[];
  } = {},
) => {
  const at = await now();
  const startDate =
    options.startDate ?? addDays(at.toISOString().slice(0, 10), options.startsInDays ?? 7);
  const id = await inTransaction(db(), (tx) =>
    createCohortWithSchedule(
      tx,
      {
        schoolId: owner.id,
        courseId: owner.course.id,
        mentorId: owner.mentor.id,
        startDate,
        timeZone: options.timeZone ?? 'Europe/Kyiv',
        capacity: options.capacity ?? 10,
        priceMinor: options.priceMinor ?? 10_000,
        currency: 'UAH',
        lessonMinutes: 90,
        schedule: {
          weekdays: [...(options.weekdays ?? [1, 2, 3, 4, 5, 6, 7])],
          localTime: options.localTime ?? '19:00',
          count: options.lessons ?? 4,
        },
      },
      { actor: SYSTEM_ACTOR, now: at },
    ),
  );
  return db().cohort.findUniqueOrThrow({ where: { id } });
};

export const book = async (who: Person, cohortId: string): Promise<string> => {
  const reply = await who.http.post('/api/enrollments', { cohortId });
  if (reply.status !== 201) throw new Error(`booking failed: ${reply.status} ${reply.text}`);
  return (reply.body as { id: string }).id;
};

export const notice = async (enrollmentId: string, amountMinor?: number) => {
  const enrollment = await db().enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    include: { cohort: true },
  });
  return {
    type: 'payment.succeeded',
    eventId: randomUUID(),
    paymentId: randomUUID(),
    schoolId: enrollment.cohort.schoolId,
    orderId: enrollmentId,
    amountMinor: amountMinor ?? enrollment.priceMinor,
    currency: enrollment.currency,
    occurredAt: new Date().toISOString(),
  };
};

/** Sends a signed notification the way the payment system does. */
export const notify = (body: object, url: string = URLS.public): Promise<Reply> => {
  const raw = JSON.stringify(body);
  return client(url).send('POST', '/api/payments/webhook', {
    raw,
    headers: { [SIGNATURE_HEADER]: sign(required('PAYSTUB_MERCHANT_KEY'), raw, new Date()) },
  });
};

export const statusOf = async (enrollmentId: string): Promise<string> =>
  (await db().enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).status;

export const awaitStatus = (enrollmentId: string, status: string) =>
  until(async () => (await statusOf(enrollmentId)) === status, `status ${status}`);

/** Pays through the stub's own page and waits for the enrollment to be settled. */
export const payOnStubPage = async (who: Person, enrollmentId: string): Promise<string> => {
  const reply = await who.http.post(`/api/enrollments/${enrollmentId}/checkout`);
  if (reply.status !== 200) throw new Error(`checkout failed: ${reply.status} ${reply.text}`);
  const path = new URL((reply.body as { payUrl: string }).payUrl).pathname;
  const paid = await client(URLS.public).send('POST', `${path}/pay`);
  if (paid.status !== 303) throw new Error(`stub refused: ${paid.status}`);
  return path;
};

export const payNow = async (who: Person, enrollmentId: string): Promise<void> => {
  await payOnStubPage(who, enrollmentId);
  await awaitStatus(enrollmentId, 'paid');
};

export type Mail = { readonly Subject: string };

export const inbox = async (address: string): Promise<readonly Mail[]> => {
  const response = await fetch(
    `${URLS.mail()}/api/v1/search?limit=200&query=${encodeURIComponent(`to:"${address}"`)}`,
  );
  return ((await response.json()) as { messages: Mail[] }).messages;
};

export const mailCount = async (address: string, subject: string): Promise<number> =>
  (await inbox(address)).filter((mail) => mail.Subject.startsWith(subject)).length;

export const violations = () => findViolations(db());

export const disconnect = async (): Promise<void> => {
  await database?.$disconnect();
  database = undefined;
};

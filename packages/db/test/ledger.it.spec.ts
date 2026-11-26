import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertInvariants, findViolations } from '../src/invariants/assert';
import { sqlStateOf, SQLSTATE } from '../src/errors';
import { createTestDatabase, type TestDatabase } from '../src/testing/database';
import { AT, createCohort, createEnrollment } from '../src/testing/factories';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase(process.env['DATABASE_URL'] ?? '');
});
afterAll(async () => {
  await database.drop();
});

const failure = (work: Promise<unknown>): Promise<string> =>
  work.then(
    () => 'it was accepted',
    (error: unknown) => `${sqlStateOf(error) ?? ''} ${String(error)}`,
  );

const paidEnrollment = async (amount = 10_000) => {
  const { cohort } = await createCohort(database.db);
  const enrollment = await createEnrollment(database.db, cohort, { status: 'paid' });
  const payment = await database.db.moneyOperation.create({
    data: {
      enrollmentId: enrollment.id,
      kind: 'payment',
      amountMinor: amount,
      currency: 'UAH',
      providerPaymentId: randomUUID(),
      createdAt: AT,
    },
  });
  return { enrollment, payment };
};

const balanceOf = async (id: string) =>
  (await database.db.enrollment.findUniqueOrThrow({ where: { id } })).balanceMinor;

const requestRefund = (enrollmentId: string, amountMinor: number, source?: string) =>
  database.db.refundRequest.create({
    data: {
      enrollmentId,
      amountMinor,
      currency: 'UAH',
      reason: source ? 'duplicate_payment' : 'cancel',
      sourcePaymentOperationId: source ?? null,
      createdAt: AT,
    },
  });

const refund = (enrollmentId: string, refundRequestId: string, amountMinor: number) =>
  database.db.moneyOperation.create({
    data: {
      enrollmentId,
      kind: 'refund',
      amountMinor,
      currency: 'UAH',
      refundRequestId,
      createdAt: AT,
    },
  });

describe('ledger', () => {
  it('posts a balanced pair of entries and derives the balance', async () => {
    const { enrollment, payment } = await paidEnrollment();
    const entries = await database.db.ledgerEntry.findMany({
      where: { operationId: payment.id },
      orderBy: { account: 'asc' },
    });
    expect(entries.map((e) => [e.account, e.debitMinor, e.creditMinor])).toEqual([
      ['enrollment', 0n, 10_000n],
      ['gateway', 10_000n, 0n],
    ]);
    expect(await balanceOf(enrollment.id)).toBe(10_000n);
    await assertInvariants(database.db);
  });

  it.each([
    'UPDATE money_operations SET amount_minor = 1',
    'DELETE FROM money_operations',
    'TRUNCATE money_operations CASCADE',
    'UPDATE ledger_entries SET debit_minor = 1',
    'DELETE FROM ledger_entries',
  ])('never rewrites history: %s', async (statement) => {
    await paidEnrollment();
    expect(await failure(database.db.$executeRawUnsafe(statement))).toContain(
      SQLSTATE.restrictViolation,
    );
  });

  it('refuses a hand-written entry that unbalances an operation', async () => {
    const { payment } = await paidEnrollment();
    const attack = database.db.ledgerEntry.create({
      data: { operationId: payment.id, account: 'gateway', debitMinor: 500 },
    });
    expect(await failure(attack)).toContain('unbalanced');
  });

  it('refuses to set a balance directly', async () => {
    const { enrollment } = await paidEnrollment();
    const attack = database.db.enrollment.update({
      where: { id: enrollment.id },
      data: { balanceMinor: 999_999 },
    });
    expect(await failure(attack)).toContain('ledger');
  });

  it('counts a provider payment once, even when recorded ten times at once', async () => {
    const { cohort } = await createCohort(database.db);
    const enrollment = await createEnrollment(database.db, cohort, { status: 'paid' });
    const record = () =>
      database.db.moneyOperation.create({
        data: {
          enrollmentId: enrollment.id,
          kind: 'payment',
          amountMinor: 700,
          currency: 'UAH',
          providerPaymentId: `pay-${enrollment.id}`,
          createdAt: AT,
        },
      });
    const results = await Promise.allSettled(Array.from({ length: 10 }, record));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balanceOf(enrollment.id)).toBe(700n);
  });

  it('rejects a payment in another currency or without a provider id', async () => {
    const { enrollment } = await paidEnrollment();
    const base = { enrollmentId: enrollment.id, kind: 'payment', amountMinor: 1, createdAt: AT };
    const foreign = database.db.moneyOperation.create({
      data: { ...base, currency: 'EUR', providerPaymentId: randomUUID() },
    });
    const anonymous = database.db.moneyOperation.create({ data: { ...base, currency: 'UAH' } });
    expect(await failure(foreign)).toContain('currency');
    expect(await failure(anonymous)).toContain(SQLSTATE.checkViolation);
  });
});

describe('refunds', () => {
  it('can be requested once per enrollment', async () => {
    const { enrollment } = await paidEnrollment();
    await requestRefund(enrollment.id, 5_000);
    expect(await failure(requestRefund(enrollment.id, 1_000))).toContain(SQLSTATE.uniqueViolation);
  });

  it('can never promise more than was paid, even when requested in parallel', async () => {
    const { enrollment, payment } = await paidEnrollment(1_000);
    const results = await Promise.allSettled([
      requestRefund(enrollment.id, 800),
      requestRefund(enrollment.id, 800, payment.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('are executed once, for exactly the requested amount', async () => {
    const { enrollment } = await paidEnrollment();
    const request = await requestRefund(enrollment.id, 4_000);
    expect(await failure(refund(enrollment.id, request.id, 4_001))).toContain('match');
    await refund(enrollment.id, request.id, 4_000);
    expect(await failure(refund(enrollment.id, request.id, 4_000))).toContain(
      SQLSTATE.uniqueViolation,
    );
    expect(await balanceOf(enrollment.id)).toBe(6_000n);
  });

  it('cannot be edited after the fact', async () => {
    const { enrollment } = await paidEnrollment();
    const request = await requestRefund(enrollment.id, 100);
    const raise = database.db.refundRequest.update({
      where: { id: request.id },
      data: { amountMinor: 10_000 },
    });
    expect(await failure(raise)).toContain(SQLSTATE.restrictViolation);
    expect(
      await failure(database.db.refundRequest.delete({ where: { id: request.id } })),
    ).toContain(SQLSTATE.restrictViolation);
  });

  it('are reported when a status and its operation disagree', async () => {
    const { enrollment } = await paidEnrollment();
    const request = await requestRefund(enrollment.id, 100);
    await database.db.refundRequest.update({
      where: { id: request.id },
      data: { status: 'succeeded', completedAt: AT },
    });
    const violations = await findViolations(database.db);
    expect(violations.map((v) => v.invariant)).toContain(
      'refund requests and refund operations agree',
    );
  });
});

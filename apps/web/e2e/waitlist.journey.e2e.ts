import { expect, test } from '@playwright/test';
import * as stack from '../../../tests/support/stack';
import { browserOf, goToPayment, payOnStub, status } from './support';

test.beforeAll(stack.resetClock);
test.afterAll(stack.disconnect);

test('no seats, waiting list, another student cancels, offer, payment', async ({ browser }) => {
  const owner = await stack.school();
  const cohort = await stack.cohort(owner, { capacity: 1 });
  const [first, second] = await stack.people(2);
  if (!first || !second) throw new Error('fixture');
  const taken = await stack.book(first, cohort.id);
  await stack.payNow(first, taken);

  const waiting = await browserOf(browser, second);
  await waiting.goto(`/courses/${owner.course.id}`);
  await expect(waiting.getByText('There are no free seats in this cohort.')).toBeVisible();
  await waiting.getByRole('button', { name: 'Join the waiting list' }).click();
  await expect(waiting.getByText(/You are on the waiting list, number 1 in line/)).toBeVisible();

  const leaving = await browserOf(browser, first);
  await leaving.goto(`/account/enrollments/${taken}`);
  await leaving.getByRole('button', { name: 'Cancel participation…' }).click();
  await expect(leaving.getByTestId('refund-preview')).toContainText('100.00');
  // While the seat is still taken nothing has been offered: not in the database, not by e-mail
  // and not on the student's own page. The outbox is written together with an offer, so an empty
  // one proves that no message is still on its way.
  const offer = { toAddress: second.email, subject: { startsWith: 'A seat is free' } };
  const place = () =>
    stack.db().waitlistEntry.findMany({ where: { cohortId: cohort.id, studentId: second.id } });
  const seats = () =>
    stack.db().enrollment.findMany({ where: { cohortId: cohort.id, studentId: second.id } });
  await waiting.goto('/account');
  await expect(waiting.getByText(/number 1 in line/)).toBeVisible();
  await expect(waiting.getByRole('link', { name: 'A seat is yours: pay now' })).toHaveCount(0);
  expect(await place()).toMatchObject([{ status: 'waiting', offeredAt: null, enrollmentId: null }]);
  expect(await seats()).toEqual([]);
  expect(await stack.db().emailOutbox.count({ where: offer })).toBe(0);
  expect(await stack.mailCount(second.email, 'A seat is free')).toBe(0);

  await leaving.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(status(leaving)).toHaveText('Refunded');

  await stack.until(
    async () => (await stack.mailCount(second.email, 'A seat is free')) >= 1,
    'the offer e-mail',
  );
  expect(await stack.mailCount(second.email, 'A seat is free')).toBe(1);
  expect(await stack.db().emailOutbox.count({ where: offer })).toBe(1);
  expect(await place()).toMatchObject([{ status: 'offered' }]);
  expect(await seats()).toMatchObject([{ status: 'offered' }]);
  await waiting.goto('/account');
  await waiting.getByRole('link', { name: 'A seat is yours: pay now' }).click();
  await expect(status(waiting)).toHaveText('Seat offered to you');
  await expect(waiting.getByRole('timer')).toContainText(/Time left to pay: 2[34]:\d\d:\d\d/);
  await goToPayment(waiting);
  await payOnStub(waiting);
  await expect(status(waiting)).toHaveText('Enrolled');
});

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
  await leaving.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(status(leaving)).toHaveText('Refunded');

  await stack.until(
    async () => (await stack.mailCount(second.email, 'A seat is free')) === 1,
    'the offer e-mail',
  );
  await waiting.goto('/account');
  await waiting.getByRole('link', { name: 'A seat is yours: pay now' }).click();
  await expect(status(waiting)).toHaveText('Seat offered to you');
  await expect(waiting.getByRole('timer')).toContainText(/Time left to pay: 2[34]:\d\d:\d\d/);
  await goToPayment(waiting);
  await payOnStub(waiting);
  await expect(status(waiting)).toHaveText('Enrolled');
});

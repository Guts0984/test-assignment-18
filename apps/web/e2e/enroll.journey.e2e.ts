import { expect, test } from '@playwright/test';
import * as stack from '../../../tests/support/stack';
import { browserOf, goToPayment, payOnStub, status } from './support';

test.beforeAll(stack.resetClock);
test.afterAll(stack.disconnect);

test('a student finds a course, holds a seat, pays, gets an e-mail, and the catalog updates live', async ({
  page,
  browser,
}) => {
  const owner = await stack.school();
  const cohort = await stack.cohort(owner, { capacity: 3 });
  const [student] = await stack.people(1);
  if (!student) throw new Error('fixture');
  const title = owner.course.title;

  // A visitor keeps the catalog open throughout.
  await page.goto('/');
  await page.getByLabel('Course title').fill(title);
  await page.getByRole('button', { name: 'Search' }).click();
  const card = page.getByTestId(`cohort-${cohort.id}`);
  await expect(card.getByTestId('free-seats')).toHaveText('3 of 3 seats free');

  const buyer = await browserOf(browser, student);
  await buyer.goto('/');
  await buyer.getByLabel('Course title').fill(title);
  await buyer.getByRole('button', { name: 'Search' }).click();
  await buyer.getByRole('link', { name: title }).click();
  await buyer.getByRole('button', { name: 'Book a seat for 15 minutes' }).click();
  await expect(status(buyer)).toHaveText('Seat reserved');
  await expect(buyer.getByRole('timer')).toContainText(/Time left to pay: 1[45]:\d\d/);

  // The seat is already gone for the visitor, without a reload.
  await expect(card.getByTestId('free-seats')).toHaveText('2 of 3 seats free');

  await goToPayment(buyer);
  await payOnStub(buyer);
  await expect(status(buyer)).toHaveText('Enrolled');
  await stack.until(
    async () => (await stack.mailCount(student.email, 'You are enrolled')) === 1,
    'the confirmation e-mail',
  );
  await expect(card.getByTestId('free-seats')).toHaveText('2 of 3 seats free');
});

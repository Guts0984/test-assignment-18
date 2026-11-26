import { expect, test } from '@playwright/test';
import * as stack from '../../../tests/support/stack';
import { browserOf, goToPayment, payOnStub, status } from './support';

test.beforeAll(async () => {
  await stack.setClock(new Date('2025-05-05T09:00:00Z'));
});
test.afterAll(async () => {
  await stack.resetClock();
  await stack.disconnect();
});

test('a transfer with a surcharge, then a cancellation after the start returns 50 %', async ({
  browser,
}) => {
  const owner = await stack.school();
  const cheap = await stack.cohort(owner, { startsInDays: 5, priceMinor: 10_000, lessons: 6 });
  const dear = await stack.cohort(owner, { startsInDays: 9, priceMinor: 14_000, lessons: 6 });
  const [student] = await stack.people(1);
  if (!student) throw new Error('fixture');
  const first = await stack.book(student, cheap.id);
  await stack.payNow(student, first);

  const page = await browserOf(browser, student);
  await page.goto(`/account/enrollments/${first}`);
  await page.getByRole('button', { name: 'Move to another cohort…' }).click();
  await expect(page.getByText(/pay UAH\s40\.00 more/)).toBeVisible();
  await page.getByRole('button', { name: 'Move here' }).click();
  await expect(status(page)).toHaveText('Seat reserved');
  await goToPayment(page);
  await payOnStub(page);
  await expect(status(page)).toHaveText('Enrolled');
  await expect(page.getByText(/paid UAH\s140\.00/)).toBeVisible();
  await stack.awaitStatus(first, 'transferred');

  await stack.setClock(new Date(dear.startsAt.getTime() + 60_000));
  await page.reload();
  await page.getByRole('button', { name: 'Cancel participation…' }).click();
  await expect(page.getByTestId('refund-preview')).toContainText(/UAH\s70\.00/);
  await expect(page.getByTestId('refund-preview')).toContainText('50%');
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(status(page)).toHaveText('Refunded');
  const id = page.url().split('/enrollments/')[1] ?? '';
  await stack.until(
    async () => (await stack.gatewayRefunds([id])).length === 1,
    'the refund at the payment system',
  );
  expect((await stack.gatewayRefunds([id])).map((r) => Number(r.amount_minor))).toEqual([7_000]);
});

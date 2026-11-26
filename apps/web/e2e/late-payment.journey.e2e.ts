import { expect, test } from '@playwright/test';
import * as stack from '../../../tests/support/stack';
import { browserOf, goToPayment, payOnStub, status } from './support';

test.beforeAll(stack.resetClock);
test.afterAll(async () => {
  await stack.resetClock();
  await stack.disconnect();
});

test('the hold expires, the payment arrives late with no seat left, and is refunded', async ({
  browser,
}) => {
  const owner = await stack.school();
  const cohort = await stack.cohort(owner, { capacity: 1 });
  const [slow, quick] = await stack.people(2);
  if (!slow || !quick) throw new Error('fixture');

  const page = await browserOf(browser, slow);
  await page.goto(`/courses/${owner.course.id}`);
  await page.getByRole('button', { name: 'Book a seat for 15 minutes' }).click();
  await expect(status(page)).toHaveText('Seat reserved');
  const id = page.url().split('/enrollments/')[1]?.split('?')[0] ?? '';
  await goToPayment(page);

  // Sixteen minutes pass on the payment page, and somebody else takes the seat.
  await stack.setClock(new Date((await stack.now()).getTime() + 16 * 60_000));
  await stack.book(quick, cohort.id);

  await payOnStub(page);
  await expect(status(page)).toHaveText('Refunded');
  await stack.until(
    async () => (await stack.mailCount(slow.email, 'Your refund was sent')) === 1,
    'the refund e-mail',
  );
  expect(await stack.mailCount(slow.email, 'Your payment is being returned')).toBe(1);
  const refunds = await stack.gatewayRefunds([id]);
  expect(refunds.map((refund) => Number(refund.amount_minor))).toEqual([10_000]);
});

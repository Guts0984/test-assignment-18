import { expect, test } from '@playwright/test';
import * as stack from '../../../tests/support/stack';
import { browserOf } from './support';

test.beforeAll(async () => {
  // A past date: moving on from here makes nothing in the seeded data due.
  await stack.setClock(new Date('2025-04-07T09:00:00Z'));
});
test.afterAll(async () => {
  await stack.resetClock();
  await stack.disconnect();
});

test('homework is returned, resubmitted and accepted, and after the last lesson comes a certificate', async ({
  browser,
}) => {
  const owner = await stack.school();
  const cohort = await stack.cohort(owner, { lessons: 1, startsInDays: 3 });
  const [student] = await stack.people(1);
  if (!student) throw new Error('fixture');
  await stack.payNow(student, await stack.book(student, cohort.id));

  const page = await browserOf(browser, student);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/account');
  await expect(page.getByTestId('progress')).toContainText('Accepted 0 of 1');
  await expect(page.getByTestId('lesson-time')).toContainText('19:00');
  const homework = page.getByTestId('homework');
  await homework.locator('summary').click();
  await homework.getByLabel('Your answer').fill('First attempt');
  await homework.getByRole('button', { name: 'Hand in' }).click();
  await expect(homework.locator('summary')).toContainText('Waiting for review');

  const mentor = await browserOf(browser, owner.mentor);
  await mentor.goto('/mentor');
  const row = mentor.getByTestId('queue-row');
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Review' }).click();
  await mentor.getByLabel('Comment for the student').fill('Please handle the empty list');
  await mentor.getByRole('button', { name: 'Return for rework' }).click();
  await expect(mentor).toHaveURL(/\/mentor$/);

  await page.reload();
  await homework.locator('summary').click();
  await expect(homework.getByText('Please handle the empty list')).toBeVisible();
  await homework.getByLabel('Your answer').fill('Second attempt');
  await homework.getByRole('button', { name: 'Hand in' }).click();
  await expect(homework.locator('summary')).toContainText('Waiting for review');

  // The resubmission reaches the open queue without a reload.
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Review' }).click();
  await mentor.getByLabel('Score, 0 to 100 (optional)').fill('95');
  await mentor.getByRole('button', { name: 'Accept' }).click();
  await expect(mentor).toHaveURL(/\/mentor$/);

  await stack.setClock(new Date((cohort.endsAt?.getTime() ?? 0) + 60_000));
  await stack.until(
    async () => (await stack.mailCount(student.email, 'Your certificate')) === 1,
    'the certificate',
  );
  await page.goto('/account/certificates');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download PDF' }).click();
  expect((await download).suggestedFilename()).toBe('certificate-1.pdf');
  await page.getByRole('link', { name: 'Public verification link' }).click();
  await expect(page.getByText('This certificate is genuine.')).toBeVisible();
});

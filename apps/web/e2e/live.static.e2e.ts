import { expect, test } from '@playwright/test';
import * as stack from '../../../tests/support/stack';
import { browserOf } from './support';

test.afterAll(stack.disconnect);

test('a tab left open keeps getting seat updates after signing out in another', async ({
  browser,
}) => {
  const owner = await stack.school();
  const cohort = await stack.cohort(owner, { capacity: 3 });
  const [viewer, first, second] = await stack.people(3);
  if (!viewer || !first || !second) throw new Error('fixture');

  const open = await browserOf(browser, viewer);
  await open.goto(`/courses/${owner.course.id}`);
  const seats = open.getByTestId('free-seats');
  await expect(seats).toHaveText('3 of 3 seats free');
  await stack.book(first, cohort.id);
  await expect(seats).toHaveText('2 of 3 seats free');

  const other = await open.context().newPage();
  await other.goto('/');
  await other.getByRole('button', { name: 'Sign out' }).click();
  await expect(other.getByRole('button', { name: 'Sign out' })).toHaveCount(0);

  await stack.book(second, cohort.id);
  await expect(seats).toHaveText('1 of 3 seats free', { timeout: 15_000 });
});

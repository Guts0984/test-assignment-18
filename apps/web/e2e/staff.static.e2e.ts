import { expect, test } from '@playwright/test';
import * as stack from '../../../tests/support/stack';
import { signIn } from './support';

test.afterAll(stack.disconnect);

test('an administrator sees why a busy mentor cannot be changed, and changes a free one', async ({
  page,
}) => {
  const owner = await stack.school();
  await stack.cohort(owner);
  const free = await stack.person('mentor', owner.id);
  const admin = await stack.person('admin', owner.id);
  await signIn(page, admin.email);
  await page.goto('/admin');

  const busy = page.getByTestId(`staff-${owner.mentor.email}`);
  await expect(busy).toContainText('Mentors 1 unfinished cohort');
  await expect(busy.getByRole('button', { name: 'Disable' })).toBeDisabled();
  await expect(busy.getByRole('button', { name: 'Make manager' })).toBeDisabled();

  const other = page.getByTestId(`staff-${free.email}`);
  await other.getByRole('button', { name: 'Disable' }).click();
  await expect(other).toContainText('Disabled');
  await other.getByRole('button', { name: 'Enable' }).click();
  await other.getByRole('button', { name: 'Make manager' }).click();
  await expect(other.getByRole('button', { name: 'Make mentor' })).toBeEnabled();
});

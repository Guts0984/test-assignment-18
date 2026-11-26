import { expect, test } from '@playwright/test';
import * as stack from '../../../tests/support/stack';
import { signIn } from './support';

test.afterAll(stack.disconnect);

test('registration shows each mistake at its field', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Full name').fill('A');
  await page.getByLabel('E-mail').fill('not-an-address');
  await page.getByLabel(/^Password/).fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  for (const label of [/^Full name/, /^E-mail/, /^Password/]) {
    const field = page.getByLabel(label);
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    const message = await field.getAttribute('aria-describedby');
    await expect(page.locator(`[id="${message ?? ''}"]`)).not.toBeEmpty();
  }
});

test('a refusal by the server is shown on the form', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('nobody@example.test');
  await page.getByLabel('Password').fill('wrong-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'The e-mail or password is wrong',
  );
});

test('server errors of a manager form appear at their fields', async ({ page }) => {
  const owner = await stack.school();
  await signIn(page, owner.manager.email);
  await page.goto('/manager/cohorts/new');
  await page.getByLabel('Course', { exact: true }).selectOption(owner.course.id);
  await page.getByLabel('Mentor').selectOption(owner.mentor.id);
  await page.getByLabel('First day').fill('2020-01-06');
  await page.getByLabel('Price').fill('100');
  await page.getByRole('button', { name: 'Create cohort' }).click();
  await expect(page.getByLabel('First day')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('The first lesson must be in the future')).toBeVisible();
  await page.getByLabel('Price').fill('1.999');
  await page.getByRole('button', { name: 'Create cohort' }).click();
  await expect(page.getByText('Enter an amount such as 250 or 250.50')).toBeVisible();
});

import { expect, test } from '@playwright/test';
import * as stack from '../../../tests/support/stack';
import { signIn } from './support';

test.afterAll(stack.disconnect);

test('A-16 catalog filters live in the address, surviving reload and Back', async ({ page }) => {
  await page.goto('/');
  const title = page.getByLabel('Course title');
  const direction = page.getByLabel('Direction');
  await direction.selectOption('programming');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/direction=programming$/);
  await title.fill('Type');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/q=Type/);

  await page.reload();
  await expect(title).toHaveValue('Type');
  await expect(direction).toHaveValue('programming');

  await page.goBack();
  await expect(page).not.toHaveURL(/q=Type/);
  await expect(title).toHaveValue('');
  await expect(direction).toHaveValue('programming');
  await page.goForward();
  await expect(title).toHaveValue('Type');
});

test('A-16 the report period and filters live in the address', async ({ page }) => {
  await signIn(
    page,
    'manager@school1.example.test',
    process.env['SEED_DEMO_PASSWORD'] ?? 'demo-password-2026',
  );
  await page.goto('/manager/report');
  await expect(page.getByTestId('occupancy')).toBeVisible();
  await page.getByLabel('From').fill('2026-01-01');
  await page.getByLabel('To').fill('2026-06-30');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page).toHaveURL(/from=2026-01-01&to=2026-06-30/);
  const first = await page.getByTestId('occupancy').textContent();
  await page.getByLabel('Currency').selectOption('EUR');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page).toHaveURL(/currency=EUR/);
  await expect(page.getByTestId('occupancy')).not.toHaveText(first ?? '');

  await page.reload();
  await expect(page.getByLabel('Currency')).toHaveValue('EUR');
  await expect(page.getByLabel('From')).toHaveValue('2026-01-01');
  await page.goBack();
  await expect(page.getByLabel('Currency')).toHaveValue('');
  await expect(page.getByTestId('occupancy')).toHaveText(first ?? '');
});

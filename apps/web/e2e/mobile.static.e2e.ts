import { expect, test, type Page } from '@playwright/test';
import * as stack from '../../../tests/support/stack';
import { signIn } from './support';

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });
test.afterAll(stack.disconnect);

/** Nothing may stick out of a 375 px screen. */
const fits = async (page: Page) => {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, page.url()).toBeLessThanOrEqual(0);
};

test('the student cabinet works on a 375 px phone', async ({ page }) => {
  // The first seeded student has enrollments, homework and a long history.
  await signIn(
    page,
    'student1@students.example.test',
    process.env['SEED_DEMO_PASSWORD'] ?? 'demo-password-2026',
  );
  for (const path of ['/account', '/account/enrollments', '/account/certificates', '/']) {
    await page.goto(path);
    await fits(page);
  }
  await page.goto('/account/enrollments');
  await page.getByRole('main').getByRole('link').first().click();
  await expect(page.getByTestId('enrollment-status')).toBeVisible();
  await fits(page);
  await page.goto('/');
  await page.getByRole('main').getByRole('listitem').getByRole('link').first().click();
  await fits(page);
  for (const link of ['My studies', 'Enrollments', 'Certificates', 'Catalog']) {
    await expect(page.getByRole('navigation', { name: 'Main' }).getByText(link)).toBeInViewport();
  }
});

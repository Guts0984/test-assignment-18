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

test('menu words stay whole beside a long name', async ({ page }) => {
  const [who] = await stack.people(1);
  if (!who) throw new Error('fixture');
  // Long enough to squeeze a menu that shares its row with the name.
  await stack.db().user.update({
    where: { email: who.email },
    data: { fullName: 'Oleksandra Shevchenkova' },
  });
  await signIn(page, who.email);
  const links = page.getByRole('navigation', { name: 'Main' }).getByRole('link');
  await expect(links).toHaveCount(4);
  const broken = await links.evaluateAll((items) =>
    items
      .filter((item) => {
        const text = document.createRange();
        text.selectNodeContents(item);
        return text.getClientRects().length > 1;
      })
      .map((item) => item.textContent),
  );
  expect(broken).toEqual([]);
  await fits(page);
});

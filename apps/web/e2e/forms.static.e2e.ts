import { expect, test, type Page, type Request } from '@playwright/test';
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

/** A manager's new-cohort form, filled in apart from the first day and the price. */
const newCohortForm = async (page: Page) => {
  const owner = await stack.school();
  await signIn(page, owner.manager.email);
  await page.goto('/manager/cohorts/new');
  await page.getByLabel('Course', { exact: true }).selectOption(owner.course.id);
  await page.getByLabel('Mentor').selectOption(owner.mentor.id);
  return {
    owner,
    firstDay: page.getByLabel('First day'),
    price: page.getByLabel('Price'),
    submit: page.getByRole('button', { name: 'Create cohort' }),
    saved: () => stack.db().cohort.findMany({ where: { schoolId: owner.id } }),
  };
};

const isCreation = (request: Request) =>
  request.method() === 'POST' && new URL(request.url()).pathname === '/api/manager/cohorts';

test('a field error from the server appears at its field of a manager form', async ({ page }) => {
  const form = await newCohortForm(page);
  // A past day passes every check in the browser; only the server knows it is too late.
  await form.firstDay.fill('2020-01-06');
  await form.price.fill('100');
  const answered = page.waitForResponse((response) => isCreation(response.request()));
  await form.submit.click();
  const response = await answered;
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({
    code: 'VALIDATION_FAILED',
    fields: [{ path: 'startDate', message: 'The first lesson must be in the future' }],
  });
  await expect(form.firstDay).toHaveAttribute('aria-invalid', 'true');
  await expect(form.firstDay).toHaveAccessibleDescription('The first lesson must be in the future');
  await expect(form.price).toHaveAttribute('aria-invalid', 'false');
  expect(await form.saved()).toEqual([]);
});

test('a malformed price is refused in the browser, without a request', async ({ page }) => {
  const form = await newCohortForm(page);
  const sent: unknown[] = [];
  page.on('request', (request) => {
    if (isCreation(request)) sent.push(request.postDataJSON());
  });
  const nextWeek = new Date((await stack.now()).getTime() + 7 * 86_400_000);
  await form.firstDay.fill(nextWeek.toISOString().slice(0, 10));
  await form.price.fill('1.999');
  await form.submit.click();
  await expect(form.price).toHaveAttribute('aria-invalid', 'true');
  await expect(form.price).toHaveAccessibleDescription('Enter an amount such as 250 or 250.50');

  // The corrected form is sent. Being the only request seen, it proves the first try sent none.
  await form.price.fill('199.90');
  await form.submit.click();
  await expect(page).toHaveURL(/\/manager\/cohorts\/[0-9a-f-]{36}$/);
  expect(sent).toMatchObject([{ priceMinor: 19_990 }]);
  expect(await form.saved()).toMatchObject([{ priceMinor: 19_990 }]);
});

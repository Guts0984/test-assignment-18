import { readFile } from 'node:fs/promises';
import { expect, type Browser, type Locator, type Page } from '@playwright/test';
import { PASSWORD, type Person } from '../../../tests/support/stack';

export const signIn = async (page: Page, email: string, password: string = PASSWORD) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
};

/** A separate browser, signed in as someone. */
export const browserOf = async (browser: Browser, who: Person): Promise<Page> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, who.email);
  return page;
};

/** The payment system's own page, reached through the enrollment page. */
export const goToPayment = async (page: Page) => {
  await page.getByRole('button', { name: 'Go to payment' }).click();
  await expect(page).toHaveURL(/\/paystub\/pay\//);
};

export const payOnStub = async (page: Page) => {
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page).toHaveURL(/\/account\/enrollments\//);
};

export const status = (page: Page) => page.getByTestId('enrollment-status');

/** Follows a download link and returns what the browser received. */
export const downloadFrom = async (page: Page, link: Locator) => {
  const started = page.waitForEvent('download');
  await link.click();
  const download = await started;
  return { name: download.suggestedFilename(), content: await readFile(await download.path()) };
};

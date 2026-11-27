import { expect, test } from '@playwright/test';
import * as stack from '../../../tests/support/stack';
import { browserOf, downloadFrom } from './support';

const ANSWER_FILE = 'answer.txt';
const ANSWER_TEXT = 'The solution, attached to the first hand-in only.\n';

/**
 * The page text is drawn as glyph numbers of an embedded font, so it cannot be searched. What
 * pdfkit writes in the clear is checked: the file frame, the font, the title and the link.
 */
const expectCertificatePdf = (content: Buffer, number: number, verifyUrl: string) => {
  const pdf = content.toString('latin1');
  expect(pdf.startsWith('%PDF-')).toBe(true);
  expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  expect(content.length).toBeGreaterThan(5_000);
  expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+DejaVuSans\b/);
  const title = /\/Title (\d+) 0 R/.exec(pdf)?.[1];
  expect(title, 'a title in the information dictionary').toBeDefined();
  expect(pdf).toContain(`\n${title} 0 obj\n(Certificate ${number})\nendobj`);
  expect(pdf).toContain('/Subtype /Link');
  const targets = [...pdf.matchAll(/\/URI \(([^)]*)\)/g)].map((match) => match[1]);
  expect(targets.length).toBeGreaterThan(0);
  expect(new Set(targets)).toEqual(new Set([verifyUrl]));
};

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
  const attached = homework.getByRole('link', { name: `Download ${ANSWER_FILE}` });
  await homework.locator('summary').click();
  await homework.getByLabel('Your answer').fill('First attempt');
  await homework.getByLabel('File (optional)').setInputFiles({
    name: ANSWER_FILE,
    mimeType: 'text/plain',
    buffer: Buffer.from(ANSWER_TEXT),
  });
  await homework.getByRole('button', { name: 'Hand in' }).click();
  await expect(homework.locator('summary')).toContainText('Waiting for review');
  await expect(attached).toBeVisible();

  const mentor = await browserOf(browser, owner.mentor);
  await mentor.goto('/mentor');
  const row = mentor.getByTestId('queue-row');
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Review' }).click();
  await mentor.getByLabel('Comment for the student').fill('Please handle the empty list');
  await mentor.getByRole('button', { name: 'Return for rework' }).click();
  await expect(mentor).toHaveURL(/\/mentor$/);

  // The returned work has left the queue and nothing is held: both lists are loaded and empty.
  await expect(mentor.getByRole('heading', { name: /^In review: 0 of \d+$/ })).toBeVisible();
  await expect(mentor.getByRole('table', { name: 'Waiting work' })).toBeVisible();
  await expect(row).toHaveCount(0);
  // A reload would build a new document, without this mark.
  await mentor.evaluate(() => {
    document.body.dataset['openedBefore'] = 'resubmission';
  });

  await page.reload();
  await homework.locator('summary').click();
  await expect(homework.getByText('Please handle the empty list')).toBeVisible();
  // The earlier file stays attached without being chosen again.
  await expect(homework.getByText(/Attached:\s*answer\.txt/)).toBeVisible();
  await expect(homework.getByLabel('Remove the attached file')).not.toBeChecked();
  await expect(homework.getByLabel('File (optional)')).toHaveValue('');
  await homework.getByLabel('Your answer').fill('Second attempt');
  await homework.getByRole('button', { name: 'Hand in' }).click();
  await expect(homework.locator('summary')).toContainText('Waiting for review');
  await expect(attached).toBeVisible();
  const kept = await downloadFrom(page, attached);
  expect(kept.name).toBe(ANSWER_FILE);
  expect(kept.content.toString('utf8')).toBe(ANSWER_TEXT);

  // The resubmission reaches the open queue without a reload.
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(owner.course.title);
  await expect(mentor.locator('body')).toHaveAttribute('data-opened-before', 'resubmission');
  await row.getByRole('button', { name: 'Review' }).click();
  await expect(mentor.getByText('Second attempt')).toBeVisible();
  await expect(mentor.getByRole('link', { name: `Download ${ANSWER_FILE}` })).toBeVisible();
  await mentor.getByLabel('Score, 0 to 100 (optional)').fill('95');
  await mentor.getByRole('button', { name: 'Accept' }).click();
  await expect(mentor).toHaveURL(/\/mentor$/);

  // The student sees the verdict with its score; the earlier return has none.
  await page.reload();
  await expect(page.getByTestId('progress')).toContainText('Accepted 1 of 1');
  await homework.locator('summary').click();
  const reviews = homework.locator('blockquote');
  await expect(reviews).toHaveCount(2);
  await expect(reviews.filter({ hasText: 'Accepted' })).toContainText('Accepted · 95/100');
  await expect(reviews.filter({ hasText: 'Please handle the empty list' })).not.toContainText(
    '/100',
  );

  await stack.setClock(new Date((cohort.endsAt?.getTime() ?? 0) + 60_000));
  await stack.until(
    async () => (await stack.mailCount(student.email, 'Your certificate')) >= 1,
    'the certificate',
  );
  expect(await stack.mailCount(student.email, 'Your certificate')).toBe(1);
  await page.goto('/account/certificates');
  const publicLink = page.getByRole('link', { name: 'Public verification link' });
  const verifyUrl = (await publicLink.getAttribute('href')) ?? '';
  expect(verifyUrl).toMatch(/\/verify\/[\w-]{20,}$/);
  const certificate = await downloadFrom(page, page.getByRole('link', { name: 'Download PDF' }));
  expect(certificate.name).toBe('certificate-1.pdf');
  expectCertificatePdf(certificate.content, 1, verifyUrl);
  await publicLink.click();
  await expect(page.getByText('This certificate is genuine.')).toBeVisible();
  await expect(page.getByRole('main')).toContainText(owner.course.title);
  await expect(page.getByRole('main')).toContainText('No. 1');
});

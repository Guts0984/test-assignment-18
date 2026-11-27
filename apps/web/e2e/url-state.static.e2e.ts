import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import * as stack from '../../../tests/support/stack';
import { signIn } from './support';

test.afterAll(stack.disconnect);

const day = (date: Date) => date.toISOString().slice(0, 10);
const daysFrom = (date: Date, days: number) => day(new Date(date.getTime() + days * 86_400_000));

const addressQuery = (page: Page) => Object.fromEntries(new URL(page.url()).searchParams);

/** A course with a chosen title, in an existing school. */
const course = async (owner: stack.School, title: string, direction: string) => ({
  ...owner,
  course: await stack.db().course.create({ data: { schoolId: owner.id, title, direction } }),
});

test('A-16 catalog filters live in the address and decide the results, surviving reload, Back and Forward', async ({
  page,
}) => {
  // A word found in these titles only, so the whole result list is known exactly.
  const word = `Urlstate${randomUUID().slice(0, 8)}`;
  const owner = await stack.school();
  const wanted = await course(owner, `${word} Programming`, 'programming');
  const other = await course(owner, `${word} Design`, 'design');
  const base = { priceMinor: 10_000, startsInDays: 20 } as const;
  // Every cohort but the first fails exactly one of the filters applied below.
  const match = await stack.cohort(wanted, base);
  const wrongDirection = await stack.cohort(other, base);
  const wrongCurrency = await stack.cohort(wanted, { ...base, currency: 'EUR' });
  const tooCheap = await stack.cohort(wanted, { ...base, priceMinor: 4_000 });
  const tooDear = await stack.cohort(wanted, { ...base, priceMinor: 30_000 });
  const tooEarly = await stack.cohort(wanted, { ...base, startsInDays: 10 });
  const tooLate = await stack.cohort(wanted, { ...base, startsInDays: 40 });
  const start = day(match.startDate);

  const everything = [match, wrongDirection, wrongCurrency, tooCheap, tooDear, tooEarly, tooLate];
  const byWord = {
    address: { q: word },
    fields: ['', '', '', '', '', ''],
    results: everything,
  };
  const byDirection = {
    address: { q: word, direction: 'programming' },
    fields: ['programming', '', '', '', '', ''],
    results: [match, wrongCurrency, tooCheap, tooDear, tooEarly, tooLate],
  };
  const byPrice = {
    address: {
      q: word,
      direction: 'programming',
      currency: 'UAH',
      priceMin: '10000',
      priceMax: '15000',
    },
    fields: ['programming', 'UAH', '100.00', '150.00', '', ''],
    results: [match, tooEarly, tooLate],
  };
  const byDate = {
    address: { ...byPrice.address, startFrom: start, startTo: start },
    fields: ['programming', 'UAH', '100.00', '150.00', start, start],
    results: [match],
  };

  const labels = ['Direction', 'Currency', 'Price from', 'Price to', 'Starts from', 'Starts until'];
  const shows = async (state: typeof byWord | typeof byDirection) => {
    await expect.poll(() => addressQuery(page)).toEqual(state.address);
    await expect
      .poll(async () => {
        const ids = await page
          .locator('[data-testid^="cohort-"]')
          .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-testid')));
        return ids.sort();
      })
      .toEqual(state.results.map(({ id }) => `cohort-${id}`).sort());
    await expect(page.getByLabel('Course title')).toHaveValue(word);
    for (const [index, label] of labels.entries()) {
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(state.fields[index] ?? '');
    }
  };
  const search = () => page.getByRole('button', { name: 'Search' }).click();

  await page.goto('/');
  await page.getByLabel('Course title').fill(word);
  await search();
  await shows(byWord);
  await page.getByLabel('Direction').selectOption('programming');
  await search();
  await shows(byDirection);
  await page.getByLabel('Currency').selectOption('UAH');
  await page.getByLabel('Price from').fill('100');
  await page.getByLabel('Price to').fill('150');
  await search();
  await shows(byPrice);
  await page.getByLabel('Starts from').fill(start);
  await page.getByLabel('Starts until').fill(start);
  await search();
  await shows(byDate);

  await page.reload();
  await shows(byDate);
  await page.goBack();
  await shows(byPrice);
  await page.goBack();
  await shows(byDirection);
  await page.goBack();
  await shows(byWord);
  await page.goForward();
  await shows(byDirection);
  await page.goForward();
  await shows(byPrice);
  await page.reload();
  await shows(byPrice);
});

test('A-16 the report period and filters live in the address and decide the figures', async ({
  page,
}) => {
  // A school of its own: every figure of its report is known exactly.
  const owner = await stack.school();
  const mark = randomUUID().slice(0, 8);
  const first = await course(owner, `Report A ${mark}`, 'programming');
  const second = await course(owner, `Report B ${mark}`, 'design');
  const hryvnia = await stack.cohort(first, { capacity: 10, startsInDays: 20 });
  const euro = await stack.cohort(first, {
    capacity: 7,
    startsInDays: 20,
    priceMinor: 20_000,
    currency: 'EUR',
  });
  await stack.cohort(second, { capacity: 5, startsInDays: 20 });
  // Starts after the period asked for below.
  await stack.cohort(first, { capacity: 3, startsInDays: 100 });
  const [one, two, three] = await stack.people(3);
  if (!one || !two || !three) throw new Error('fixture');
  await stack.payNow(one, await stack.book(one, hryvnia.id));
  await stack.payNow(two, await stack.book(two, euro.id));
  await stack.payNow(three, await stack.book(three, euro.id));
  const today = await stack.now();
  const from = daysFrom(today, -1);
  const to = daysFrom(today, 30);
  const period = { from, to };

  const euroMoney = ['EUR', /^€400\.00$/, /^€0\.00$/];
  const hryvniaMoney = ['UAH', /^UAH\s100\.00$/, /^UAH\s0\.00$/];
  const whole = {
    address: period,
    fields: ['', ''],
    occupancy: '3 cohorts, 3 of 22 seats',
    courses: [first.course.title, '2', '3/17', second.course.title, '1', '0/5'],
    money: [...euroMoney, ...hryvniaMoney],
  };
  const inEuro = {
    address: { ...period, currency: 'EUR' },
    fields: ['', 'EUR'],
    occupancy: '1 cohorts, 2 of 7 seats',
    courses: [first.course.title, '1', '2/7'],
    money: euroMoney,
  };
  const ofSecond = {
    address: { ...period, courseId: second.course.id },
    fields: [second.course.id, ''],
    occupancy: '1 cohorts, 0 of 5 seats',
    courses: [second.course.title, '1', '0/5'],
    money: [],
  };

  const cells = (name: string) => page.getByRole('table', { name }).locator('tbody td');
  const shows = async (state: {
    readonly address: Readonly<Record<string, string>>;
    readonly fields: readonly string[];
    readonly occupancy: string;
    readonly courses: readonly string[];
    readonly money: readonly (string | RegExp)[];
  }) => {
    await expect.poll(() => addressQuery(page)).toEqual(state.address);
    await expect(page.getByTestId('occupancy')).toHaveText(state.occupancy);
    await expect(cells('By course')).toHaveText([...state.courses]);
    await expect(cells('Money')).toHaveText([...state.money]);
    await expect(page.getByLabel('From')).toHaveValue(from);
    await expect(page.getByLabel('To')).toHaveValue(to);
    const [courseId = '', currency = ''] = state.fields;
    await expect(page.getByLabel('Course', { exact: true })).toHaveValue(courseId);
    await expect(page.getByLabel('Currency')).toHaveValue(currency);
  };
  const show = () => page.getByRole('button', { name: 'Show' }).click();

  await signIn(page, owner.manager.email);
  await page.goto('/manager/report');
  // The default period ends today, before any of these cohorts starts.
  await expect(page.getByTestId('occupancy')).toHaveText('0 cohorts, 0 of 0 seats');
  await page.getByLabel('From').fill(from);
  await page.getByLabel('To').fill(to);
  await show();
  await shows(whole);
  await page.getByLabel('Currency').selectOption('EUR');
  await show();
  await shows(inEuro);
  await page.getByLabel('Currency').selectOption('');
  await page.getByLabel('Course', { exact: true }).selectOption(second.course.id);
  await show();
  await shows(ofSecond);

  await page.reload();
  await shows(ofSecond);
  await page.goBack();
  await shows(inEuro);
  await page.goBack();
  await shows(whole);
  await page.goForward();
  await shows(inEuro);
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from './attacker/app';
import { client } from './attacker/client';
import { sellingCohort, siblingCohort } from './attacker/money';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.stop();
});

describe('catalog search', () => {
  it('narrows by title, direction, start date and price, and counts free seats', async () => {
    const sale = await sellingCohort(api, { capacity: 4, priceMinor: 10_000 });
    await api.db.course.update({
      where: { id: sale.course.id },
      data: { title: 'Embroidery for beginners', direction: 'crafts' },
    });
    const later = await siblingCohort(api, sale, {
      priceMinor: 30_000,
      startsAt: new Date('2026-08-04T16:00:00Z'),
    });
    const ids = async (query: string) => {
      const reply = await client(api.url).get(`/api/catalog/cohorts?${query}`);
      return (reply.body as { items: { cohortId: string }[] }).items.map((i) => i.cohortId);
    };
    const mine = 'q=EMBROID';
    expect(await ids(mine)).toEqual([sale.cohort.id, later.id]);
    expect(await ids(`${mine}&direction=crafts`)).toHaveLength(2);
    expect(await ids(`${mine}&direction=data`)).toEqual([]);
    expect(await ids('q=nothing-like-it')).toEqual([]);
    expect(await ids(`${mine}&startFrom=2026-08-04`)).toEqual([later.id]);
    expect(await ids(`${mine}&startTo=2026-04-07`)).toEqual([sale.cohort.id]);
    expect(await ids(`${mine}&currency=UAH&priceMin=10001`)).toEqual([later.id]);
    expect(await ids(`${mine}&currency=UAH&priceMax=10000`)).toEqual([sale.cohort.id]);
    expect(await ids(`${mine}&currency=EUR`)).toEqual([]);
    expect(await ids(`${mine}&pageSize=1&page=2`)).toEqual([later.id]);
    const first = await client(api.url).get(`/api/catalog/cohorts?${mine}&pageSize=1`);
    expect(first.body).toMatchObject({ total: 2, items: [{ capacity: 4, freeSeats: 4 }] });
  });
});

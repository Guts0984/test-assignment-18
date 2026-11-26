import { describe, expect, it } from 'vitest';
import { toCohortInput, type CohortFields } from './cohort-form';

const fields: CohortFields = {
  courseId: '018f6f1e-7b1a-7c3e-9d6a-111111111111',
  mentorId: '018f6f1e-7b1a-7c3e-9d6a-222222222222',
  startDate: '2026-09-01',
  timeZone: 'Europe/Kyiv',
  capacity: '12',
  price: '2500,50',
  currency: 'UAH',
  weekdays: [2, 4],
  localTime: '19:00',
  count: '12',
};

describe('toCohortInput', () => {
  it('converts the price to minor units', () => {
    expect(toCohortInput(fields)).toMatchObject({
      input: { priceMinor: 250_050, capacity: 12, schedule: { count: 12 } },
    });
  });

  it('puts every mistake at its own field', () => {
    const result = toCohortInput({
      ...fields,
      price: '1.999',
      capacity: '',
      weekdays: [],
      localTime: '7pm',
      timeZone: 'Kyiv',
    });
    expect('problems' in result && Object.keys(result.problems).sort()).toEqual(
      ['capacity', 'localTime', 'price', 'timeZone', 'weekdays'].sort(),
    );
  });
});

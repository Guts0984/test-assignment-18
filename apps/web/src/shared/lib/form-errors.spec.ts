import { describe, expect, it } from 'vitest';
import { mapApiError } from './form-errors';

const error = {
  message: 'Check the highlighted fields',
  fields: [
    { path: 'email', message: 'Invalid' },
    { path: 'schedule.localTime', message: 'Expected HH:mm' },
  ],
};

describe('mapApiError', () => {
  it('puts each error at its field, renaming nested paths', () => {
    expect(mapApiError(error, ['email', 'time'], { 'schedule.localTime': 'time' })).toEqual({
      fields: [
        { path: 'email', message: 'Invalid' },
        { path: 'time', message: 'Expected HH:mm' },
      ],
      form: null,
    });
  });

  it('never swallows an error that has no field on the form', () => {
    const mapped = mapApiError(error, ['email']);
    expect(mapped.fields).toHaveLength(1);
    expect(mapped.form).toContain('schedule.localTime: Expected HH:mm');
    expect(mapApiError({ message: 'No seats' }, ['email']).form).toBe('No seats');
  });
});

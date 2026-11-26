import { describe, expect, it } from 'vitest';
import { pageFrom, readQuery, toSearch } from './query-string';

describe('filters in the address', () => {
  it('survive a round trip, including special characters', () => {
    const filters = { q: 'C++ & "Go" #1', direction: 'programming', page: 3 };
    const search = toSearch(filters);
    expect(readQuery(search, ['q', 'direction', 'page'])).toEqual({
      q: filters.q,
      direction: 'programming',
      page: '3',
    });
  });

  it('omits empty values and page one', () => {
    expect(toSearch({ q: '', direction: undefined, page: 1 })).toBe('');
  });

  it('ignores keys the page does not know', () => {
    expect(readQuery('?q=a&evil=1&__proto__=2', ['q'])).toEqual({ q: 'a' });
  });

  it.each(['0', '-1', '1.5', 'abc', '999999', undefined])('treats page %s as the first', (p) => {
    expect(pageFrom(p)).toBe(1);
  });
});

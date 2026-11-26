import { describe, expect, it } from 'vitest';
import { safeNext } from './roles';

describe('safeNext', () => {
  it('keeps a local path', () => {
    expect(safeNext('/courses/1?x=2', '/account')).toBe('/courses/1?x=2');
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    '',
    null,
  ])('refuses to redirect to %s', (next) => {
    expect(safeNext(next, '/account')).toBe('/account');
  });
});

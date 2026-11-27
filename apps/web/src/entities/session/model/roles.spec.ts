import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { safeNext } from './roles';

describe('safeNext', () => {
  it('never produces an address that leaves the site, for any input', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom('/', '\\', '.', '\t', '\n', '\r', ' ', '%', '2', 'f', 'e', ':', '@', 'a'),
          {
            maxLength: 12,
          },
        ),
        (parts) => {
          const result = safeNext(`/${parts.join('')}`, '/account');
          expect(new URL(result, 'https://school.example').origin).toBe('https://school.example');
        },
      ),
      { numRuns: 3_000 },
    );
  });

  it('keeps a local path', () => {
    expect(safeNext('/courses/1?x=2', '/account')).toBe('/courses/1?x=2');
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    // `?next=%2F%09%2Fexample.com`: the browser strips the tab and leaves `//example.com`.
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r\n//evil.example',
    ' //evil.example',
    '//',
    '///',
    '/ /evil.example',
    '/.//evil.example',
    '/..//evil.example',
    '/%2e//evil.example',
    '/x\\..\\\\evil.example',
    '',
    null,
  ])('refuses to redirect to %s', (next) => {
    expect(safeNext(next, '/account')).toBe('/account');
  });
});

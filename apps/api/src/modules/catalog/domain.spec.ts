import { describe, expect, it } from 'vitest';
import { likePattern } from './domain';

describe('likePattern', () => {
  it('keeps wildcards in the search term literal', () => {
    expect(likePattern('100%_Go\\')).toBe('%100\\%\\_go\\\\%');
    expect(likePattern("x' OR 1=1 --")).toBe("%x' or 1=1 --%");
  });
});

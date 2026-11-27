import { describe, expect, it } from 'vitest';
import { checkAnswer, MAX_FILE_BYTES } from './check';

describe('checkAnswer', () => {
  it('needs text or a file', () => {
    expect(checkAnswer({ body: '  ', file: null }).body).toBeDefined();
    expect(checkAnswer({ body: '', file: { name: 'a.PDF', size: 1 } })).toEqual({});
  });

  it('is satisfied by an earlier file that stays attached', () => {
    expect(checkAnswer({ body: '', file: null, keepsFile: true })).toEqual({});
    expect(checkAnswer({ body: '', file: null, keepsFile: false }).body).toBeDefined();
  });

  it('checks the type and size of a file', () => {
    expect(checkAnswer({ body: 'x', file: { name: 'a.exe', size: 1 } }).file).toBeDefined();
    expect(
      checkAnswer({ body: 'x', file: { name: 'a.zip', size: MAX_FILE_BYTES + 1 } }).file,
    ).toBeDefined();
  });
});

import { describe, expect, it } from 'vitest';
import { safeFileName, sniffFile } from './file-type';

const pdf = Buffer.from('%PDF-1.7 content');

describe('sniffFile', () => {
  it('accepts content that matches its extension', () => {
    expect(sniffFile('work.PDF', pdf)).toBe('application/pdf');
    expect(sniffFile('notes.txt', Buffer.from('привіт'))).toBe('text/plain');
  });

  it.each([
    ['work.pdf', Buffer.from('<html><script>alert(1)</script>')],
    ['page.html', Buffer.from('<html>')],
    ['script.svg', Buffer.from('<svg onload=alert(1)>')],
    ['run.exe', Buffer.from('MZ')],
    ['notes.txt', Buffer.from([0x4d, 0x5a, 0x00, 0x01])],
    ['notes.txt', Buffer.from([0xff, 0xfe, 0xfd])],
    ['work.pdf', Buffer.alloc(0)],
    ['__proto__', pdf],
    ['work.constructor', pdf],
  ])('rejects %s', (name, content) => {
    expect(sniffFile(name, content)).toBeUndefined();
  });
});

describe('safeFileName', () => {
  it.each([
    ['../../etc/passwd', 'passwd'],
    ['C:\\temp\\a.pdf', 'a.pdf'],
    ['a"b\r\nSet-Cookie: x.pdf', 'a_b__Set-Cookie_ x.pdf'],
    ['...hidden', 'hidden'],
    ['', 'file'],
  ])('cleans %j', (input, expected) => {
    expect(safeFileName(input)).toBe(expected);
  });

  it('keeps the end of a very long name', () => {
    const name = safeFileName(`${'a'.repeat(500)}.pdf`);
    expect(name).toHaveLength(120);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});

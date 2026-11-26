import { FILE_TYPES } from '@school/shared/schemas/homework';

const startsWith = (content: Buffer, signature: readonly number[]): boolean =>
  signature.every((byte, index) => content[index] === byte);

const isText = (content: Buffer): boolean => {
  if (content.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content);
    return true;
  } catch {
    return false;
  }
};

const ZIP = [0x50, 0x4b, 0x03, 0x04];

const MATCHES: Readonly<Record<keyof typeof FILE_TYPES, (content: Buffer) => boolean>> = {
  pdf: (c) => startsWith(c, [0x25, 0x50, 0x44, 0x46, 0x2d]),
  zip: (c) => startsWith(c, ZIP),
  docx: (c) => startsWith(c, ZIP),
  png: (c) => startsWith(c, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: (c) => startsWith(c, [0xff, 0xd8, 0xff]),
  jpeg: (c) => startsWith(c, [0xff, 0xd8, 0xff]),
  txt: isText,
};

/** A name safe to store and to send back: no paths, no control or quoting characters. */
export const safeFileName = (name: string): string => {
  const base = name.split(/[/\\]/).at(-1) ?? '';
  const clean = base
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}"';%<>|*?:]/gu, '_')
    .replace(/^\.+/, '')
    .trim();
  return clean.slice(-120) || 'file';
};

/** The MIME type, if the extension is allowed and the content really is of that kind. */
export const sniffFile = (name: string, content: Buffer): string | undefined => {
  const extension = name.split('.').at(-1)?.toLowerCase() ?? '';
  if (!Object.hasOwn(FILE_TYPES, extension)) return undefined;
  const key = extension as keyof typeof FILE_TYPES;
  return content.length > 0 && MATCHES[key](content) ? FILE_TYPES[key] : undefined;
};

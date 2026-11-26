import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

const keyOf = (base64: string): Buffer => {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('The encryption key must be 32 bytes in base64');
  return key;
};

/** Encrypts a secret for storage. The result is `iv.tag.ciphertext` in base64. */
export const seal = (plaintext: string, key: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyOf(key), iv);
  const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), sealed].map((part) => part.toString('base64')).join('.');
};

export const open = (box: string, key: string): string => {
  const [iv, tag, sealed] = box.split('.').map((part) => Buffer.from(part, 'base64'));
  if (!iv || !tag || !sealed) throw new Error('Not a sealed secret');
  const decipher = createDecipheriv(ALGORITHM, keyOf(key), iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed), decipher.final()]).toString('utf8');
};

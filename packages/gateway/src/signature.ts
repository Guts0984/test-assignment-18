import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-signature';

const mac = (key: string, timestamp: number, body: Buffer | string): Buffer =>
  createHmac('sha256', key).update(`${timestamp}.`).update(body).digest();

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">` */
export const sign = (key: string, body: Buffer | string, at: Date): string => {
  const timestamp = Math.floor(at.getTime() / 1000);
  return `t=${timestamp},v1=${mac(key, timestamp, body).toString('hex')}`;
};

/** Constant-time check of the signature and of its age, in either direction. */
export const verify = (input: {
  readonly key: string;
  readonly header: string | undefined;
  readonly body: Buffer | string;
  readonly now: Date;
  readonly maxSkewSec: number;
}): boolean => {
  const match = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(input.header ?? '');
  if (!match) return false;
  const [, rawTime = '', hex = ''] = match;
  const timestamp = Number(rawTime);
  const expected = mac(input.key, timestamp, input.body);
  const authentic = timingSafeEqual(expected, Buffer.from(hex, 'hex'));
  const age = Math.abs(input.now.getTime() / 1000 - timestamp);
  return authentic && age <= input.maxSkewSec;
};

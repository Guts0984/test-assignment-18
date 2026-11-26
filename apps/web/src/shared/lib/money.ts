import { formatMoney, type Currency } from '@school/shared/money/money';

export { formatMoney, type Currency };

/** "250", "250.5" or "250,50" in major units to minor units, without floating point. */
export const parseMajor = (input: string): number | null => {
  const match = /^(\d{1,8})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const [, whole = '', fraction = ''] = match;
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
};

export const toMajor = (amountMinor: number): string => (amountMinor / 100).toFixed(2);

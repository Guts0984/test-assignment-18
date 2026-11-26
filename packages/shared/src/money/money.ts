import { z } from 'zod';

export const CURRENCIES = ['UAH', 'EUR', 'USD'] as const;
export const currencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof currencySchema>;

/** Upper bound for a single price, in minor units. */
export const MAX_PRICE_MINOR = 1_000_000_000;

/** An amount in the minor units of a currency. Floats and negatives are rejected. */
export const amountMinorSchema = z.number().int().min(0).max(MAX_PRICE_MINOR);

/** `percent` of `amountMinor`, rounded down to a whole minor unit. */
export const percentOf = (amountMinor: number, percent: number): number =>
  Math.floor((amountMinor * percent) / 100);

export const formatMoney = (amountMinor: number, currency: Currency, locale = 'en-GB'): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amountMinor / 100);

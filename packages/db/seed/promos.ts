import { type Tx } from '../src/client';
import { SCHOOL_COUNT } from './sizes';

export const seedPromos = async (tx: Tx, now: Date): Promise<void> => {
  await tx.$executeRawUnsafe(
    `INSERT INTO promo_codes (id, school_id, code, discount_kind, percent, amount_minor,
                              currency, valid_from, valid_until, max_uses, created_at)
     SELECT gen_random_uuid(), md5('school-' || s)::uuid, p.code || s, p.kind, p.percent,
            p.amount, p.currency, $2::timestamptz - interval '1 day',
            $2::timestamptz + make_interval(days => p.days), p.uses, $2
       FROM generate_series(1, $1::int) s,
            (VALUES ('WELCOME', 'percent', 15, NULL::int, NULL, 180, 1000),
                    ('FIRST10-', 'percent', 50, NULL, NULL, 90, 10),
                    ('MINUS50EUR-', 'fixed', NULL, 5000, 'EUR', 90, 100))
              p(code, kind, percent, amount, currency, days, uses)`,
    SCHOOL_COUNT,
    now,
  );
};

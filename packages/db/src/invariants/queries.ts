/**
 * Each query returns the rows that break one invariant; a healthy database returns none.
 * They read only history and current state, so they hold after any scenario.
 */
export const INVARIANT_QUERIES = {
  'seat counters equal the journal sum': `
    SELECT c.id FROM cohorts c
    LEFT JOIN (SELECT cohort_id, sum(seats_delta) AS seats, sum(capacity_delta) AS capacity
                 FROM seat_journal GROUP BY cohort_id) j ON j.cohort_id = c.id
    WHERE c.seats_taken <> coalesce(j.seats, 0) OR c.capacity <> coalesce(j.capacity, 0)`,
  'seats stay within capacity': `
    SELECT id FROM cohorts WHERE seats_taken < 0 OR seats_taken > capacity`,
  'seat counters equal the seat-holding enrollments': `
    SELECT c.id FROM cohorts c
    LEFT JOIN (SELECT cohort_id, count(*) AS occupied FROM enrollments
                WHERE status IN ('held', 'offered', 'paid', 'completed')
                GROUP BY cohort_id) e ON e.cohort_id = c.id
    WHERE c.seats_taken <> coalesce(e.occupied, 0)`,
  'each enrollment journal matches its status': `
    SELECT e.id FROM enrollments e
    LEFT JOIN (SELECT enrollment_id, sum(seats_delta) AS seats FROM seat_journal
                WHERE enrollment_id IS NOT NULL GROUP BY enrollment_id) j
      ON j.enrollment_id = e.id
    WHERE coalesce(j.seats, 0) <>
      CASE WHEN e.status IN ('held', 'offered', 'paid', 'completed') THEN 1 ELSE 0 END`,
  'balances equal the ledger': `
    SELECT e.id FROM enrollments e
    LEFT JOIN (SELECT enrollment_id, sum(credit_minor - debit_minor) AS balance
                 FROM ledger_entries WHERE account = 'enrollment' GROUP BY enrollment_id) l
      ON l.enrollment_id = e.id
    WHERE e.balance_minor <> coalesce(l.balance, 0) OR e.balance_minor < 0`,
  'balances equal the sum of operations': `
    SELECT e.id FROM enrollments e
    LEFT JOIN (SELECT enrollment_id,
                      sum(CASE WHEN kind IN ('payment', 'transfer_in') THEN amount_minor
                               ELSE -amount_minor END) AS balance
                 FROM money_operations GROUP BY enrollment_id) o ON o.enrollment_id = e.id
    WHERE e.balance_minor <> coalesce(o.balance, 0)`,
  'every operation is balanced in the ledger': `
    SELECT o.id FROM money_operations o
    LEFT JOIN (SELECT operation_id, sum(debit_minor) AS debit, sum(credit_minor) AS credit
                 FROM ledger_entries GROUP BY operation_id) l ON l.operation_id = o.id
    WHERE l.debit IS DISTINCT FROM o.amount_minor OR l.credit IS DISTINCT FROM o.amount_minor`,
  'transfers move equal amounts out and in': `
    SELECT 1 FROM ledger_entries WHERE account = 'transfer'
    HAVING coalesce(sum(debit_minor), 0) <> coalesce(sum(credit_minor), 0)`,
  'refund requests and refund operations agree': `
    SELECT r.id FROM refund_requests r
    LEFT JOIN money_operations o ON o.refund_request_id = r.id
    WHERE (r.status = 'succeeded') <> (o.id IS NOT NULL)
       OR (o.id IS NOT NULL AND o.amount_minor <> r.amount_minor)`,
  'no money waits without a seat': `
    SELECT e.id FROM enrollments e
    WHERE e.status IN ('held', 'offered', 'expired', 'transferred')
      AND e.balance_minor > coalesce((SELECT sum(amount_minor) FROM refund_requests r
            WHERE r.enrollment_id = e.id AND r.status = 'pending'), 0)`,
  'promo counters equal redemptions and respect the limit': `
    SELECT p.id FROM promo_codes p
    LEFT JOIN (SELECT promo_id,
                      count(*) FILTER (WHERE state = 'used') AS used,
                      count(*) FILTER (WHERE state = 'reserved') AS reserved
                 FROM promo_redemptions GROUP BY promo_id) r ON r.promo_id = p.id
    WHERE p.used_count <> coalesce(r.used, 0) OR p.reserved_count <> coalesce(r.reserved, 0)
       OR p.used_count + p.reserved_count > p.max_uses`,
  'certificate numbers are consecutive per course': `
    SELECT course_id FROM certificates GROUP BY course_id
    HAVING min(number) <> 1 OR max(number) <> count(*)`,
  'open offers match the waitlist': `
    SELECT w.id FROM waitlist_entries w
    LEFT JOIN enrollments e ON e.id = w.enrollment_id
    WHERE w.status = 'offered' AND e.status IS DISTINCT FROM 'offered'
    UNION ALL
    SELECT e.id FROM enrollments e
    WHERE e.status = 'offered' AND NOT EXISTS
      (SELECT 1 FROM waitlist_entries w WHERE w.enrollment_id = e.id AND w.status = 'offered')`,
} as const;

export type InvariantName = keyof typeof INVARIANT_QUERIES;

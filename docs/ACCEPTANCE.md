# Acceptance results

Produced by `node scripts/acceptance/run.mjs` on 2026-11-26T20:26Z
against the docker compose stack with the full seed.

| Check | Result | Seconds | Evidence |
|---|---|---|---|
| A-1 | pass | 400 | clean `cp .env.example .env && docker compose up --build` |
| A-2 | pass | 213 | typecheck ok, lint ok, gen:client ok, test ok, client unchanged; CI runs the same on every commit |
| A-3 | pass | 2 | 200 simultaneous bookings for 5 seats through both api copies give exactly 5 |
| A-4 | pass | 3 | a payment at the moment of expiry always ends enrolled or refunded, never both |
| A-5 | pass | 2 | three freed seats go to the first three, and an unpaid offer passes to the fourth |
| A-6 | pass | 2 | 50 simultaneous payments with a 10-use promo code: exactly 10 are discounted |
| A-7 | pass | 3 | a transfer racing for the last seat leaves the student in exactly one cohort |
| A-8 | pass | 4 | one notification sent 10 times to both copies is one payment; chaos refunds all arrive once |
| A-9 | pass | 1 | cancelling a minute before the start in New York returns 100 %, a minute after 50 % |
| A-10 | pass | 9 | a lesson in the daylight saving week stays at 19:00 Kyiv; a late move sends each reminder once |
| A-11 | pass | 12 | workers stopped, clock at the end, two workers started: one certificate each, numbered in a row |
| A-12 | pass | 7 | kill -9 during expiry and FLUSHALL during bookings: all finished, nothing twice |
| A-13 | pass | 5 | seat journal equals counters and operations equal balances, for every cohort and enrollment |
| A-14 | pass | 0 | a booking through copy B updates the manager and the catalog on copy A within a second |
| A-15 | pass | 0 | other people’s data is refused over HTTP and over the socket |
| A-16 | pass | 7 | searches the catalog in under 200 ms; opens the mentor queue in under 200 ms; finds a student by name or e-mail in under 300 ms; builds the twelve-month report in under 1 s; latency budgets on the full seed; Playwright: reload and Back keep the filters |
| A-17 | pass | 0 | README sections, transition tables, jobs, indexes |

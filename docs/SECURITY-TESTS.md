# Security and abuse tests

Every test drives the real server over real HTTP and sockets against real PostgreSQL and Redis;
the worker tests kill real processes; the `A-n` checks run against the docker compose stack.
Test files live in `apps/api/test`, `apps/worker/test`, `apps/web/e2e` and `tests`.

| Area | Attack | Expected and observed | Tests |
|---|---|---|---|
| Authentication | Forged, unsigned (`alg:none`), re-signed, wrong-algorithm and expired tokens | 401 | auth.adv |
| Authentication | Replayed or concurrently used refresh token | 401, the whole family is revoked | auth.adv |
| Authentication | Disabled account keeps using its session or socket | 401 at once; rooms refused | auth.adv, realtime.adv |
| Enumeration | Unknown address vs wrong password; registering a taken address | Identical answers; account unchanged | auth.adv |
| CSRF | Foreign, `null` or look-alike origin; form post; cross-site fetch | 403 / 415, nothing written | csrf.adv |
| Authorization | Every registered route × anonymous and each role | 401 / 403; a new route must state its audience | route-sweep.adv |
| IDOR | Another student’s enrollment, refund preview, transfer, checkout, file, certificate | 404, nothing changes | idor.adv, study-access.adv |
| IDOR | Another mentor’s work: read, claim, review, release, download | 404 / nothing to review | study-access.adv, mentor-claim.race.adv |
| Tenancy | Manager or admin of another school on cohorts, lessons, courses, promos, staff, jobs, reports | 404 / empty | tenancy.adv, idor.adv, reports.it |
| Mass assignment | `role`, `schoolId`, `studentId`, `priceMinor`, `status`, `isLate`, counters in bodies and forms | 400, nothing written | mass-assignment.adv, idor.adv, homework.it |
| Input | Floats, negatives, bad dates and zones, `__proto__`, NUL, oversized and malformed bodies, SQL and LIKE injection | Shared error shape with a code; never a bare 500 | input.adv |
| Upload | HTML or script disguised as PDF, wrong types, too large, path in the name | 400 / 413; files only ever download | homework.it, file-type.spec |
| Rate limit | Flood from one address; parallel flood over two copies | 429 with `Retry-After`; other addresses unaffected; shared window | limiter.adv |
| Rate limit | Spoofed `X-Forwarded-For` / `X-Real-IP` | No bypass, no blocking of a victim | limiter.adv, edge.x |
| Rate limit | Lock a victim out of their account | Owner still signs in from elsewhere | limiter.adv |
| Rate limit | Redis down | Fails open (documented), or closed when configured | limiter.adv |
| Rate limit | Booking and notification bursts under tight limits | Never throttled | limiter.adv |
| Webhook | Forged, stale, altered, wrong school, other school’s key | 401 / rejected, nothing recorded | webhook.adv |
| Webhook | Gateway key used as a credential elsewhere | 401 | webhook.adv |
| Replay | Same notification ×10 on both copies; same payment under new event ids | One payment | webhook.adv |
| Seats | 200 racing for 5 seats; 20 racing for 1, 20 times; many tabs | Exactly the free seats | last-seats.race.adv, A-3 |
| Queue jumping | Rejoin, extra tabs, booking directly while others wait | Order unchanged | waitlist.race.adv |
| Expiry | Payment at the expiry instant against a rival, 20 times | Enrolled or refunded, never both | expiry-vs-payment.race.adv, A-4 |
| Promo | 50 parallel uses of a 10-use code; foreign, expired, stacked codes | Exactly 10; others refused | promo.race.adv, A-6 |
| Refund | Cancel racing exclude ×20; cancel after cheaper transfer; 500s, timeouts, early notice | One refund, never above what was paid | double-refund.race.adv, refund-chaos.adv |
| Transfer | Race for the last seat, opposite directions, race with cancel | Exactly one cohort, no deadlock | transfer.race.adv, A-7 |
| Review | 20 parallel claims; mentor change mid-review | At most 5; one reviewer | mentor-claim.race.adv |
| Certificate link | Numbers, ids, near-miss and random tokens | 404 | study-access.adv |
| Realtime | Anonymous, foreign and forged joins; foreign origin; malformed messages | Refused | realtime.adv, A-15 |
| Ledger and history | Direct update, delete, truncate; unbalanced entry; over-refund | Rejected by the database | ledger.it, constraints.it |
| Worker crash | `kill -9` during expiry, certificates, e-mail | Finished once; at most the in-flight e-mail repeats | worker-kill.adv, certificates.adv, A-12 |
| Redis loss | `FLUSHALL` with work pending | Rebuilt from Postgres, nothing twice | flushall.adv, A-12 |
| Test control | Clock route when disabled or with a wrong token | 404 / 401 | test-clock.it |
| Logs | Passwords, tokens, cookies, keys in log fields | Redacted | logger.spec |

All of the above pass in CI on every commit. Bugs they found are listed in
[BUGS_FOUND.md](BUGS_FOUND.md).

## Mutation check

Each protection was switched off on purpose (`node scripts/mutation-check.mjs`), the guarding
tests were run, and the file was restored. A test suite that stays green here would be worthless.

<!-- mutation:start -->

| Protection disabled | Change | Test run | Result with the protection off | Caught |
|---|---|---|---|---|
| Login rate limiter | the limiter guard lets everything through | `apps/api/test/adv/limiter.adv.spec.ts` | 8 failed \| 2 passed (10) | yes |
| Authentication and role guard | the global auth guard lets everything through | `apps/api/test/adv/route-sweep.adv.spec.ts` | 5 failed \| 2 passed (7) | yes |
| Input validator (strict booking body) | unknown fields are accepted when booking | `apps/api/test/adv/idor.adv.spec.ts` | 1 failed \| 4 passed (5) | yes |
| Seat row lock | cohort rows are read without FOR NO KEY UPDATE | `apps/api/test/adv/last-seats.race.adv.spec.ts` | 3 failed (3) | yes |
| Seat capacity constraint | the CHECK seats_taken <= capacity is removed | `packages/db/test/constraints.it.spec.ts` | 5 failed \| 11 passed (16) | yes |
| One refund per enrollment (unique index) | the partial unique index is not unique | `packages/db/test/ledger.it.spec.ts` | 1 failed \| 14 passed (15) | yes |
| Payment notification signature | every signature is accepted | `apps/api/test/adv/webhook.adv.spec.ts` | 3 failed \| 4 passed (7) | yes |

<!-- mutation:end -->

## Known limits

- Rate limiting covers only sign-in and registration (optional hardening). It fails open when
  Redis is down, by default.
- A signed-out access token stays valid until its 15-minute lifetime ends; the refresh family is
  revoked at once and a disabled account is refused immediately.
- A worker killed between the mail server accepting a message and the database update may send
  that one message again.
- The payment stub is a test double: its transaction pages are open to anyone who can reach it.

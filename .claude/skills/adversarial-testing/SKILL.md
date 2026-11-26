# Adversarial testing

Goal: find bugs, not confirm the happy path. Every test must be able to fail. A few sharp tests beat many shallow ones. The exact numbers (seat counts, hold TTL, promo limits, queue admission rate, latency budgets) come from ASSIGNMENT.md. The values below are placeholders.

## Setup

- Use real Postgres and Redis (docker compose or testcontainers). Never mock the db, Redis or the job queue.
- Most tests run against the real Nest app on an ephemeral port, with real worker processes. A small cross-stack suite runs through nginx with two api copies and the worker. Use it only for the multi-copy, client-IP and realtime scenarios.
- Keep a small harness of functional helpers in `apps/api/test/attacker/`:
  - `client({ ip, auth })`: real HTTP, with a distinct source IP via `localAddress: '127.0.0.N'`
  - `burst(n, fn)`: truly parallel requests released by one start barrier
  - `socket({ auth, apiCopy })`: a real realtime client that records the events it receives
  - `chaos`: `killWorker()`, `restartWorker()`, `flushRedis()`
  - `stubs`: control and inspect the payment stub and the mail stub (calls received, emails sent)
  - `clock`: advances the shared test clock (no real sleeps)
  - `assertInvariants()`: ledger debits equal credits; no seat sold or held twice; sold + held + free = capacity; promo uses ≤ limit; nothing negative

## Concurrency and money (most important)

End each test with `assertInvariants()`. Run each race in a loop of about 20 iterations.

- **Last seats:** N parallel holds for fewer seats (and for one exact seat) give exactly capacity holds, the rest get a clear error, and no seat is double-booked.
- **Hold expiry vs payment:** a payment that lands at the exact moment its hold expires produces either a paid ticket or a released seat. Never both, and never money with no ticket.
- **Duplicate payment:** the same payment or idempotency key sent 10× in parallel across both api copies gives one charge and one set of tickets. The same key with a different body gives an error.
- **Payment stub limits:** above 20 rps the stub returns `429`. The system retries or backs off, and no payment is lost or charged twice. Duplicate or out-of-order stub callbacks change nothing, and a callback with a bad signature is rejected, if the assignment has callbacks.
- **Double refund:** parallel refund requests for one order produce one refund and a balanced ledger.
- **Mass cancellation:** cancelling an event with many orders refunds each order exactly once and sends each email exactly once, even if the worker is killed halfway through and restarted.
- **Promo:** parallel applications of a code with limit L succeed exactly L times. An expired code, a code for another event, or stacking codes is rejected.
- **Transfer:** after a transfer the old QR code is invalid and the new one works. A transfer racing with a scan or a refund ends in one consistent outcome.
- **QR scan:** two gates scan the same ticket at once and exactly one admits it. Tampered, forged, refunded and transferred-away QR codes are rejected.
- **Waitlist:** freed seats go to the earliest waiters first, nobody gets an offer twice, and an expired offer moves to the next person.

## Virtual queue and Redis

- **Mass join:** 1,000 parallel joiners get unique, gap-free positions in arrival order, and admission follows the configured rate.
- **Queue jumping:** rejoining, opening several tabs, or forging or replaying an admission token does not improve a position or skip the queue.
- **Redis wiped:** `FLUSHALL` while holds, queue positions and jobs are pending loses no orders, money or positions. The reconciler rebuilds the jobs from Postgres and each one fires exactly once.
- **Worker crash:** a `kill -9` mid-job followed by a restart finishes everything with no double effect. Two workers on the same job produce the effect once.
- **Failed job:** a job that has used up its retries is visible to the admin and can be retried by hand.

## Time edges

- Hold expiry at TTL−1 s, TTL and TTL+1 s.
- Sales start and end, and refund or transfer deadlines, exactly at the boundary and one second either side.
- Event times across a DST change in the event's time zone. Displayed times respect the locale.

## Permissions

- **Route sweep:** iterate the Nest route table. Every protected route returns 401 without credentials and 403 with the wrong role. This one test replaces dozens of hand-written ones.
- **IDOR:** user A cannot read, refund, transfer or download user B's orders or tickets (expect 404 or 403). An organizer cannot touch another organizer's venues or events. A scanner works only for its own event.
- **Tokens:** a tampered token, `alg: none`, an expired token, and reuse of an already-rotated refresh token are all rejected, and the reuse revokes the whole token family.
- **Mass assignment:** extra body fields such as `role`, `status`, `price`, `userId` or `paidAt` are rejected or ignored.
- **Realtime:** an unauthenticated connection is rejected, a client cannot join another user's private room, and a seat change on copy B reaches a client on copy A within the assignment's budget (1 s if none is given).

## Rate limiter (optional hardening, keep it)

Run these with the limiter profile on.

- **Flood:** A floods from IP X and gets `429` with `Retry-After`, while B and C on other IPs keep getting 2xx.
- **Spoofing:** a spoofed `X-Forwarded-For` neither bypasses A's limit nor blocks the victim's IP. Only nginx's header is trusted.
- **Shared limit:** the limit is counted across both api copies, and N parallel requests cannot go over it.
- **No collateral damage:** the acceptance scenarios (200 concurrent holds, 150 promo applications, 1,000 queue joiners, mass cancellation) still pass with the configured limits.
- **Redis down:** the limiter behaves as documented (fail-open or fail-closed), and the core flows still work.

## Input

- One table-driven test per endpoint group with bad values: negative, zero and fractional quantities or prices; a float where minor units are expected; invalid dates and time zones; an unknown locale; an oversized body (→ 413); malformed JSON; `__proto__`; and an SQL-injection string in search.
- Every error matches the shared error schema with a stable `code`. Never a bare 500, a stack trace or SQL.

## Rules

- Assert on status, body and db side effects, and check that other users and events are unaffected.
- Poll with a timeout instead of sleeping. Each test creates its own data so tests can run in parallel. No `.skip` or `.only`.
- **Mutation check:** once the suite is green, temporarily disable the auth guard, one validator, the seat lock or unique constraint, and the rate limiter. The matching tests must fail. Restore the code.
- When a test finds a bug: keep the test, fix the code, and add a row to `docs/BUGS_FOUND.md`.

## Report

`docs/SECURITY-TESTS.md` contains a table of attack | expected | result | test file, followed by the mutation-check results.

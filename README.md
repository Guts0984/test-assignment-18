# Online school with course cohorts

A school sells courses in cohorts: a start date, a schedule of live lessons in the cohort's time
zone, a limited number of seats and a price. Students book a seat, pay, hand in homework and earn
a certificate; mentors review the homework; managers run courses, cohorts, refunds and transfers.

| Part | What it is |
|---|---|
| `apps/api` | NestJS REST + OpenAPI + Socket.IO. Two copies run behind nginx. |
| `apps/worker` | NestJS process with BullMQ processors and the recovery sweeper. Run as many as you like. |
| `apps/web` | Next.js 15 (App Router), React 19, TanStack Query, React Hook Form, Tailwind. |
| `apps/paystub` | The payment system stub: payment page, signed notifications, refunds, chaos mode. |
| `packages/shared` | Rules used everywhere: schedules, deadlines, refunds, certificates, statuses, zod schemas. |
| `packages/db` | Prisma schema, SQL migrations, the seed and every transactional rule. |
| `packages/gateway`, `packages/queue` | Signed payment protocol; job publisher and live updates. |

PostgreSQL 16 is the only source of truth. Redis 7 holds disposable state (queues, Socket.IO
channels, login rate-limit counters): wiping it loses nothing.

## Running it

```bash
cp .env.example .env && docker compose up --build
```

No other step is needed. Migrations and the seed run by themselves; the first start takes a while
because the full seed takes 4–9 minutes (`SEED_SCALE=0.01` gives a small one in seconds).

| Address | What |
|---|---|
| <http://localhost:8080> | Web application |
| <http://localhost:8080/docs> | Swagger UI (`/docs-json` for the document) |
| <http://localhost:8080/paystub/> | Payment system: all payments and refunds |
| <http://localhost:8025> | Mailbox with every e-mail |

The values in `.env.example` work as they are. Its secrets are **development placeholders**:
replace them before exposing the system. Useful settings:

- `PAYSTUB_CHAOS_MODE=true` turns on the payment system's chaos mode: each payment announced
  twice, to both api copies at once; some announced 20 minutes late; some refund notifications
  before the refund response; every fifth refund request answered with 500 or not at all.
- `docker compose up --scale worker=3` runs several workers.
- `COMPOSE_SUBNET` is the containers' private network. Change it if it overlaps yours; the api
  trusts the proxy on whatever network is set.
- If you change `HTTP_PORT`, change `PUBLIC_BASE_URL`, `CORS_ORIGINS` and `PAYSTUB_PUBLIC_URL`
  to match.

## Tests

Requirements: Node 22+, pnpm 10 (via `corepack enable`), Docker.

```bash
pnpm install
cp .env.example .env
docker compose up -d --wait postgres redis mailpit

pnpm typecheck
pnpm lint            # ESLint, FSD boundaries, Steiger, dependency check, README check
pnpm gen:client      # OpenAPI document and web client; CI fails if they change
pnpm test            # builds, then unit, integration, adversarial and worker chaos suites
pnpm test:integration
pnpm test:adversarial
pnpm test:chaos      # real worker processes, kill -9 and a Redis flush
```

Against the running stack (movable test clock):

```bash
./scripts/env-test.sh .env.test
ENV_FILE=.env.test docker compose --env-file .env.test \
  -f docker-compose.yml -f docker-compose.test.yml up -d --build --wait
pnpm exec playwright install chromium
pnpm test:acceptance     # acceptance checks 3–15 and the final reconciliation
pnpm test:e2e            # the five journeys, 375 px, form errors, address state
```

`pnpm acceptance` runs all 17 acceptance checks from a clean state and writes
[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md). See [docs/SECURITY-TESTS.md](docs/SECURITY-TESTS.md)
for the attack table and the mutation check, and [docs/BUGS_FOUND.md](docs/BUGS_FOUND.md) for the
bugs the tests found.

Time-dependent rules (the 15-minute hold, the 24-hour offer, reminders, deadlines, refund
boundaries) take the time as input. Tests inject a clock; the stack has a shared clock in
Postgres that `POST /api/__test/clock` moves, available only when `TEST_CLOCK_ENABLED=true`.

## Logins

Every seeded account uses the password **`demo-password-2026`** (`SEED_DEMO_PASSWORD`).
There are four schools, `N` from 1 to 4.

| Role | E-mail |
|---|---|
| Administrator | `admin@school1.example.test` … `admin@school4.example.test` |
| Manager | `manager@school1.example.test` … `manager@school4.example.test` |
| Mentor | `mentor1@school1.example.test` (mentors 1–25 in each school at full scale) |
| Student | `student1@students.example.test` (students 1–300000 at full scale) |

The seed has 200 courses, 2,000 cohorts in `Europe/Kyiv`, `Europe/Warsaw` and
`America/New_York` and in UAH, EUR and USD, 300,000 students, about 520,000 enrollments,
1,000,000 submissions and 100,000 certificates. Six cohorts start within days (half with two free
seats, half full with a waiting list), and one cohort per time zone has lessons around the next
daylight saving change.

## Seats: how they are counted and why they cannot be oversold

**Occupied** = enrollments in `held`, `offered`, `paid` or `completed`.

1. **The journal.** Every change of occupancy is a row in `seat_journal`: cohort, seat delta,
   capacity delta, enrollment, who, when. Reasons: `hold`, `payment`, `offer`, `expiry`,
   `transfer_in`, `transfer_out`, `cancel`, `exclude`, `capacity`. The journal is append-only.
2. **Counters follow the journal.** `cohorts.seats_taken` and `cohorts.capacity` are written only
   by a trigger on the journal; any other write is rejected. So counter = journal sum by
   construction.
3. **The database refuses overselling.** `CHECK (seats_taken <= capacity)`. A deferred trigger
   also rejects any commit where an enrollment's status and its journal disagree, so a status
   cannot change without a journal row.
4. **One writer at a time per cohort.** Every transaction that changes a cohort first locks its
   row (`FOR NO KEY UPDATE`), then expires overdue holds and offers, then gives free seats to
   waiting students, and only then does its own work. Locks are taken in cohort-id order.
5. **Waiting students come first.** A booking succeeds only if there are more free seats than
   waiting students. A freed seat is offered to the first waiter inside the transaction that
   frees it, so nobody can slip in between: one seat, one offer, for 24 hours (never past the
   cohort start). An unpaid offer expires and the seat goes to the next one, once.
6. **Transfer** locks both cohorts, takes the new seat and frees the old one in one transaction.
   If there is no seat, nothing changes. With a surcharge, the new seat is held for 15 minutes
   and both happen when it is paid; until then the student stays in the old cohort.
7. **Capacity** can be raised (new seats go to the waiting list first) but never below the
   seats taken.

Result: 200 simultaneous bookings for the last 5 seats through two api copies give exactly 5
holds; the other 195 get `NO_SEATS` and may join the waiting list.

## Holds, payments, refunds and transfers under concurrency and retries

**Money** is stored in minor units. Operations (`payment`, `refund`, `transfer_out`,
`transfer_in`) are append-only; the database writes a balanced pair of ledger entries for each
and derives the enrollment balance from them. `CHECK (balance >= 0)` and a trigger on refund
requests make it impossible to return more than was paid.

| Situation | Protection |
|---|---|
| Two bookings of one student | Partial unique index; the second returns the same hold |
| Hold expiry job runs twice, late or early | Only an overdue `held`/`offered` row changes, under the cohort lock: the seat returns once |
| Payment at the instant of expiry | Both paths take the same lock. A payment at or after the expiry instant is «late» even if no worker has run: enrolled if a seat is free for them, otherwise refunded in full |
| Same notification 10 times, both copies | `(school, event id)` unique; processing locks the stored row; `(provider payment id)` unique |
| Second payment, wrong amount, payment for a cancelled enrollment | Recorded, then returned by its own refund request |
| Forged or replayed notification | HMAC-SHA256 over `timestamp.body`, per-school key, ±300 s, constant-time comparison |
| Promo limit of 10, 50 payers | A use is reserved under a row lock; `CHECK (used + reserved <= max)`; unpaid holds release it |
| Student cancels while the manager excludes | Same lock; the second finds nothing to cancel; one refund request per enrollment (unique index) |
| Refund request times out or gets 500 | Retried with the request id as idempotency key; the stub performs it once |
| Refund notification before the refund response | Both call one function that books the refund once (unique refund operation) |
| Transfer racing a booking or a cancellation | Both cohorts locked in order; exactly one outcome |

Price is fixed when the seat is booked. A promo code lowers it; a percent discount is rounded
down. A price of zero enrolls at once. Refunds: before the start 100 %, before the third lesson
50 %, later nothing, rounded down; at exactly a boundary the lower percentage applies.

A student may transfer only before their own cohort starts; later a manager does it. The new
enrollment can never be refunded at a higher percentage than the old one could at the moment of
the move.

## Schedule, reminders and deadlines across time zones

A lesson is defined by **local date and time in the cohort's zone** (`local_date`, `local_time`).
The UTC instant is derived from them, so a lesson stays at the same wall time all year. Students
see instants converted to their own zone.

- A wall time that happens twice (autumn) means the first occurrence; a wall time that does not
  exist (spring) means the first instant after the gap.
- **Homework deadline**: end of 23:59 cohort-local, seven days after the lesson's local date.
  Later submissions are accepted and marked late.
- **Reminders**: 24 hours and 1 hour before a lesson, and 24 hours before a deadline (to
  students who have not handed in). They are rows with a due instant and the lesson's version.

**Example on a daylight saving change.** «Tuesdays and Thursdays at 19:00 Kyiv», starting
23 March 2026; Kyiv moves its clocks on Sunday 29 March:

| Lesson | Kyiv | UTC | New York student |
|---|---|---|---|
| Thu 26 March | 19:00 (+02:00) | 17:00 | 13:00 |
| Tue 31 March | 19:00 (+03:00) | 16:00 | 12:00 |

The homework of the lesson of 24 March is due 31 March at 23:59 Kyiv, which is 20:59 UTC, one
hour earlier in UTC than it would have been before the change.

**Moving a lesson** increases its version, cancels the pending reminders of the old version and
creates new ones in the same transaction; a reminder whose version is old is never sent. A
day-ahead reminder whose moment already passed is not sent for the new time; the one-hour one is.
Each e-mail has a unique key `lesson:version:kind:student`.

## Background jobs

<!-- generated:jobs -->

| Queue | When a job is queued | Protection against running twice |
| --- | --- | --- |
| `hold-expiry` | When a hold or a waitlist offer is created, delayed until it expires | Job id per enrollment and expiry time; expiry only moves held or offered rows |
| `waitlist-offers` | By the sweeper when a cohort has free seats and waiting students (a freed seat is normally offered inside the transaction that frees it) | Allocation locks the cohort row and offers only free seats |
| `payment-notifications` | When a signed payment or refund notification is stored | Unique provider event id; a processed notification is skipped |
| `refunds` | When a refund request is created | Idempotency key sent to the gateway; one refund operation per request |
| `lesson-reminders` | By the sweeper when a reminder falls due, 24 h and 1 h before a lesson | One row per lesson, kind and lesson version; unique email key per student |
| `deadline-reminders` | By the sweeper when a reminder falls due, 24 h before a homework deadline | One row per homework, kind and version; unique email key per student |
| `certificates` | When a cohort ends, or homework is accepted after it ended | Unique certificate per enrollment; number taken in the same transaction |
| `emails` | When an email is written to the outbox | Unique dedupe key; a row is claimed with a lease before sending |

<!-- /generated:jobs -->

**Retries.** `JOB_ATTEMPTS` (8) with exponential backoff from `JOB_BACKOFF_MS` (2 s). When the
last attempt fails, the worker writes it to `job_failures` in Postgres. The manager sees it under
**Failed jobs** and can retry it; until then it is not run again automatically.

**Duplicates.** Job ids are deterministic and, more importantly, every handler is a guarded
database transition: twice, late, early or on two workers at once has the effect of once.
E-mail is claimed with a lease before sending. The one window left: a worker killed between the
mail server's acceptance and the database update may send that single message again.

**Recovery after Redis loss.** Postgres records all pending work (expiry times, unprocessed
notifications, pending refunds, due reminders, certificates due, unsent e-mail). Every
`SWEEP_INTERVAL_MS` each worker's sweeper reads what is due and queues it again, and closes
finished cohorts. The sweeper is a plain timer, so `FLUSHALL` cannot remove it.

## Status tables

### Enrollment

<!-- generated:enrollment-transitions -->

| From | To | Who | When |
| --- | --- | --- | --- |
| (new) | `held` | student, manager | A free seat is booked |
| (new) | `offered` | system | A freed seat goes to the waitlist |
| (new) | `paid` | student, manager | Transfer with nothing left to pay |
| `held` | `paid` | system | Payment received, or the price is zero |
| `held` | `expired` | system | The 15-minute hold ran out |
| `held` | `cancelled` | student, manager | Cancelled before paying |
| `offered` | `paid` | system | Offer paid, or the price is zero |
| `offered` | `expired` | system | The 24-hour offer ran out |
| `offered` | `cancelled` | student, manager | Offer declined |
| `expired` | `paid` | system | Late payment and a seat is free |
| `expired` | `refunded` | system | Late payment that cannot be honoured |
| `cancelled` | `refunded` | system | Payment arrived after cancellation |
| `paid` | `transferred` | student, manager, system | Moved to another cohort (system: surcharge paid) |
| `paid` | `refunded` | student, manager | Cancelled or excluded with money returned |
| `paid` | `cancelled` | student, manager | Cancelled or excluded with nothing to return |
| `paid` | `completed` | system | The last lesson ended |

<!-- /generated:enrollment-transitions -->

`system` means a payment notification or a background job.

### Homework

<!-- generated:submission-transitions -->

| From | To | Who | When |
| --- | --- | --- | --- |
| (new) | `submitted` | student | First submission |
| `submitted` | `submitted` | student | Replaced before a mentor takes it |
| `returned` | `submitted` | student | Resubmitted after remarks |
| `submitted` | `in_review` | mentor | A mentor takes it |
| `in_review` | `submitted` | mentor | The reviewer releases it |
| `in_review` | `accepted` | mentor | The reviewer accepts it |
| `in_review` | `returned` | mentor | The reviewer returns it |

<!-- /generated:submission-transitions -->

## Database indexes and constraints

<!-- generated:database -->

### Unique constraints and unique indexes

| Name | Purpose |
| --- | --- |
| `enrollments_one_active_idx` | One seat-holding enrollment per student and cohort (partial) |
| `waitlist_one_active_idx` | One waiting or offered entry per student and cohort (partial) |
| `waitlist_entries_enrollment_id_key` | An offer belongs to one waiting-list entry |
| `refund_requests_one_per_enrollment_idx` | At most one refund of an enrollment (partial) |
| `refund_requests_source_payment_operation_id_key` | An unwanted payment is returned once |
| `money_operations_provider_payment_id_key` | A provider payment is recorded once |
| `money_operations_refund_request_id_key` | A refund request is executed once |
| `payment_notifications_school_id_provider_event_id_key` | A notification is stored once |
| `payment_sessions_enrollment_id_amount_minor_key` | One payment page per enrollment and price |
| `payment_sessions_provider_session_id_key` | Provider session ids are unique |
| `certificates_course_id_number_key` | No repeated certificate number in a course |
| `certificates_enrollment_id_key` | One certificate per enrollment |
| `certificates_verify_token_key` | The public link finds exactly one certificate |
| `email_outbox_dedupe_key_key` | The same email is never queued twice |
| `scheduled_notifications_lesson_id_kind_lesson_version_key` | One reminder of each kind per lesson version |
| `submissions_homework_id_enrollment_id_key` | One work per homework and enrollment |
| `homeworks_lesson_id_key` | One homework per lesson |
| `lessons_cohort_id_seq_key` | Lesson numbers are unique in a cohort |
| `promo_codes_school_id_code_key` | Codes are unique in a school |
| `job_failures_queue_job_id_key` | One failure record per job |
| `refresh_tokens_token_hash_key` | A refresh token hash is unique |
| `users_email_key` | One account per e-mail |
| `schools_name_key` | School names are unique |

### CHECK constraints

| Name | Purpose |
| --- | --- |
| `cohorts_seats_check` | `0 <= seats_taken <= capacity` |
| `cohorts_price_check` | Price is not negative |
| `cohorts_currency_check` | UAH, EUR or USD |
| `cohorts_minutes_check` | Lesson length 15–480 minutes |
| `lessons_range_check` | A lesson ends after it starts |
| `lessons_time_check` | Local time is `HH:mm` |
| `enrollments_status_check` | Only the eight statuses |
| `enrollments_hold_check` | Held and offered enrollments have an expiry |
| `enrollments_price_check` | `0 <= price <= list price` |
| `enrollments_currency_check` | UAH, EUR or USD |
| `enrollments_balance_check` | A balance is never negative: nothing leaves that did not arrive |
| `enrollments_refund_cap_check` | The refund cap carried by a transfer is 0, 50 or 100 % |
| `seat_journal_reason_check` | Only the known reasons |
| `seat_journal_actor_check` | Only the known actors |
| `seat_journal_delta_check` | One row moves at most one seat |
| `seat_journal_shape_check` | Capacity rows have no enrollment; seat rows have one |
| `money_operations_kind_check` | payment, refund, transfer_out, transfer_in |
| `money_operations_amount_check` | Amounts are positive |
| `money_operations_source_check` | Payments carry a provider id, refunds a request |
| `ledger_entries_account_check` | Only the three accounts |
| `ledger_entries_owner_check` | Enrollment entries name their enrollment |
| `ledger_entries_side_check` | An entry is either a debit or a credit |
| `refund_requests_amount_check` | Amounts are positive |
| `refund_requests_status_check` | pending or succeeded |
| `refund_requests_reason_check` | Only the known reasons |
| `promo_codes_discount_check` | A percent 1–100, or a positive amount in a currency |
| `promo_codes_window_check` | Valid until is after valid from |
| `promo_codes_code_check` | Codes are upper case |
| `promo_codes_limit_check` | `used + reserved <= max uses` |
| `promo_redemptions_state_check` | reserved, used or released |
| `promo_redemptions_discount_check` | A discount is not negative |
| `waitlist_status_check` | Only the known statuses |
| `waitlist_offer_check` | An offered entry points at its offer |
| `submissions_status_check` | Only the four statuses |
| `submissions_reviewer_check` | A reviewer exists exactly while the work is in review |
| `submission_files_size_check` | The stored size matches the content |
| `submission_reviews_verdict_check` | accepted or returned |
| `submission_reviews_score_check` | Score 0–100 |
| `certificates_number_check` | Numbers start at 1 |
| `scheduled_kind_check` | Only the three reminder kinds |
| `scheduled_status_check` | pending, done or cancelled |
| `email_status_check` | pending, sending or sent |
| `test_clock_single_check` | The test clock has one row |
| `users_role_check` | Only the four roles |
| `users_school_check` | Staff have a school, students have none |
| `users_email_lower_check` | E-mail addresses are lower case |

### Triggers

| Name | Purpose |
| --- | --- |
| `seat_journal_apply` | Updates `seats_taken` and `capacity` from new journal rows |
| `cohorts_counter_guard` | The counters cannot be written any other way |
| `enrollments_occupancy` | At commit, each enrollment’s journal matches its status (deferred) |
| `seat_journal_occupancy` | The same check, when a journal row is added (deferred) |
| `seat_journal_append_only` | No update or delete |
| `seat_journal_no_truncate` | No truncate |
| `money_operations_append_only` | No update or delete |
| `money_operations_no_truncate` | No truncate |
| `money_operations_check` | Currency matches the enrollment; a refund matches its request |
| `money_operations_post` | Writes the balanced pair of ledger entries |
| `ledger_entries_append_only` | No update or delete |
| `ledger_entries_no_truncate` | No truncate |
| `ledger_entries_balance` | Updates the enrollment balance from new entries |
| `ledger_entries_balanced` | At commit, debits equal credits and the amount (deferred) |
| `enrollments_balance_guard` | Balance only through the ledger; cohort and student never change |
| `refund_requests_guard` | Only `pending` to `succeeded`; never edited or deleted |
| `refund_requests_cover` | Pending refunds never exceed the balance |
| `promo_redemptions_apply` | Updates the promo counters from redemptions |
| `promo_codes_counter_guard` | The counters cannot be written any other way |
| `certificates_append_only` | No update or delete |
| `certificates_consecutive` | Accepts only the next number of the course |
| `enrollments_school_students` | Keeps the student search table current |
| `users_school_students` | Follows a change of name or e-mail |

### Indexes for queries

| Name | Purpose |
| --- | --- |
| `courses_title_trgm_idx` | Catalog search by title (trigram) |
| `courses_direction_idx` | Catalog filter by direction |
| `courses_school_id_idx` | A school’s courses |
| `cohorts_start_date_id_idx` | Catalog by start date |
| `cohorts_price_minor_idx` | Catalog filter by price |
| `cohorts_course_id_idx` | Cohorts of a course |
| `cohorts_mentor_id_idx` | Cohorts of a mentor |
| `cohorts_school_id_start_date_idx` | Manager lists and report |
| `cohorts_open_idx` | Cohorts still to be closed (partial) |
| `lessons_cohort_id_starts_at_idx` | Schedule in order |
| `homeworks_cohort_id_idx` | Homework of a cohort |
| `homeworks_deadline_at_idx` | Report by deadline |
| `enrollments_cohort_id_status_idx` | Roster and occupancy |
| `enrollments_cohort_cover_idx` | Report joins without reading the table |
| `enrollments_student_id_idx` | A student’s enrollments |
| `enrollments_transfer_from_id_idx` | Pending transfers of an enrollment |
| `enrollments_expiry_idx` | Due holds and offers (partial) |
| `enrollments_certificate_due_idx` | Certificate work waiting (partial) |
| `seat_journal_cohort_id_idx` | History of a cohort |
| `seat_journal_enrollment_id_idx` | History of an enrollment |
| `money_operations_enrollment_id_idx` | Operations of an enrollment |
| `money_operations_kind_created_at_idx` | Money by kind and time |
| `money_operations_report_idx` | Revenue report without reading the table (partial) |
| `ledger_entries_operation_id_idx` | Balance check of an operation |
| `ledger_entries_enrollment_id_idx` | Ledger account of an enrollment |
| `refund_requests_enrollment_id_idx` | Refunds of an enrollment |
| `refund_requests_created_at_idx` | Refunds in order |
| `refund_requests_pending_idx` | Refunds still to deliver (partial) |
| `payment_notifications_pending_idx` | Notifications still to process (partial) |
| `promo_redemptions_promo_id_idx` | Redemptions of a code |
| `waitlist_fifo_idx` | First in line (partial) |
| `waitlist_entries_cohort_id_status_idx` | Waiting list of a cohort |
| `waitlist_entries_student_id_idx` | A student’s waiting lists |
| `waitlist_entries_offered_at_idx` | Conversion report |
| `submissions_queue_idx` | Mentor queue, oldest first (partial) |
| `submissions_reviewer_idx` | Work a mentor holds (partial) |
| `submissions_on_time_idx` | On-time share without reading the table |
| `submissions_enrollment_id_idx` | Work of an enrollment |
| `submissions_student_id_idx` | Work of a student |
| `submission_reviews_submission_id_reviewed_at_idx` | Reviews, newest first |
| `submission_reviews_mentor_idx` | Reviews by a mentor |
| `certificates_student_id_idx` | A student’s certificates |
| `certificates_issued_at_idx` | Certificates in order |
| `certificates_report_idx` | Certificates report without reading the table |
| `scheduled_due_idx` | Reminders that are due (partial) |
| `email_pending_idx` | Emails still to send (partial) |
| `job_failures_open_idx` | Unresolved failures (partial) |
| `job_failures_school_id_failed_at_idx` | A school’s failed jobs |
| `school_students_order_idx` | Student search results in name order |
| `school_students_search_idx` | Search by part of a name or e-mail (trigram, per school) |
| `school_students_student_idx` | Renames |
| `users_school_id_role_idx` | Staff of a school |
| `refresh_tokens_family_id_idx` | Revoking a token family |
| `refresh_tokens_user_id_idx` | Sessions of a user |

Primary keys and foreign keys are defined in the Prisma schema.

<!-- /generated:database -->

## Decisions

Points the assignment leaves open, and what was chosen.

<!-- generated:decisions -->

**Tenancy and roles**
- AS-1 **Multiple schools.** «менеджер — только свою школу» implies more than one school. Seed: 4 schools. Staff (admin, manager, mentor) belong to exactly one school and have exactly one role. Students are global accounts with no school, so a student can enroll in any school.
- AS-2 **Admin is per school.** It manages that school's staff and gateway config. There is no platform super-admin. Seed creates one admin per school.
- AS-3 **Mentor scope.** Each cohort has exactly one mentor (assignment: cohort fields include «ментор»). "Own students" means students with a paid or completed enrollment in a cohort the mentor is assigned to. If the manager reassigns the mentor, submissions already `in_review` stay with their reviewer until they are resolved or released.
- AS-4 **Manager's student view.** A manager can search students enrolled (any status) in their school's cohorts. Students with no enrollment in that school are invisible.

**Seats, holds, waitlist**
- AS-5 **Seat count.** Seats taken = `held + offered + paid + completed`. `completed` keeps the seat because the cohort is over. `transferred`, `cancelled`, `refunded` and `expired` free it.
- AS-6 **One active enrollment per student per cohort** (partial unique index). A second hold returns the existing one (idempotent).
- AS-7 **Waitlist priority.** If a cohort has waiting entries, a new hold succeeds only when `free seats > waiting count`. Otherwise the request gets `NO_SEATS` and may join the waitlist. Freed seats are allocated to the waitlist in the same transaction that frees them (`allocateFreedSeats`). A `waitlist-offers` job runs the same function as a safety net for capacity increases and recovery. So a regular hold can never take a freed seat from a waiter.
- AS-8 **Offers.** An offer creates an enrollment with status `offered` (seat taken, `hold_expires_at = now + 24h`). An unpaid offer becomes `expired` and that waiter's entry becomes `offer_expired`. They do not return to the queue. The seat goes to the next waiter in the same transaction. Joining the waitlist again puts the student at the end.
- AS-9 **Waitlist anti-jumping.** One active waitlist entry per student per cohort. Rejoining or using several tabs returns the original position. A student who holds a seat in the cohort can't join its waitlist.
- AS-10 **Capacity decrease** below `taken` → `CAPACITY_BELOW_TAKEN` (409). Increase → journal row with `capacity_delta`, then `allocateFreedSeats`.

**Price, promo, payment**
- AS-11 **Promo scope and type.** Per school. Either a percent (1–100) or a fixed amount in a given currency (only applies to cohorts in that currency). Optional course restriction. Validity is `[valid_from, valid_until)` in UTC. Price never goes below 0. If the discounted price is 0, the promo use is consumed and the enrollment becomes `paid` immediately with no payment operation (balance 0, nothing to refund). No stacking: one promo per enrollment.
- AS-12 **Promo consumption.** «скидку получили ровно 10 при 50 одновременных оплатах»: a use is *reserved* atomically when the promo is applied to a `held` or `offered` enrollment (`used + reserved < max_uses`, row lock). The price is re-fixed with the discount. The reservation becomes a use on payment and is released when the hold expires or is cancelled unpaid. The other 40 get `PROMO_EXHAUSTED` and keep the full price. A promo can also be passed with the hold request itself, through the same path.
- AS-13 **Late payment and promo.** A late payment for an expired enrollment that had a promo enrolls only if the seat is free **and** a promo use can be re-acquired. Otherwise it is fully auto-refunded.
- AS-14 **Payment amount mismatch** (paid ≠ fixed price), a payment for a `cancelled`, `refunded` or `transferred` enrollment, or a second distinct payment for an already-paid enrollment → recorded, then fully auto-refunded. Money without a seat never stays.
- AS-15 **Payment flow.** `POST /enrollments/:id/checkout` creates a stub session (idempotent per enrollment and price), and the browser is redirected to the stub page. Decline and close leave the hold as it is until it expires. The student can retry checkout.
- AS-16 **Gateway config.** Admin sets base URL and key per school. The key is stored AES-256-GCM encrypted with `GATEWAY_ENCRYPTION_KEY` and is write-only in the API (never returned, only `configured: true` and the last 4 chars). Seed points all schools at the compose stub with `PAYSTUB_MERCHANT_KEY`. The stub has one merchant key. Notifications carry `schoolId` so the api picks the right key.
- AS-17 **Webhook auth.** `X-Signature: t=<unix>,v1=<hex HMAC-SHA256(t.body)>` with a ±300 s skew limit on wall-clock time, not the test clock. The stub signs at send time, so a 20-minute-late delivery is still fresh. Comparison is constant-time. Replays are idempotent through `provider_event_id` unique.

**Transfer, cancel, refund**
- AS-18 **Who transfers.** The student self-serves («просит перевод» is a request the system grants automatically when the rules allow). The manager can transfer any student of their school. Same course, same currency only (`TRANSFER_CURRENCY_MISMATCH`). The target must have a seat under AS-7 rules. Transfer only from `paid`, and only before the target cohort starts.
- AS-19 **Price difference.** `credit = net paid on the old enrollment`, `diff = target cohort's current price − credit`.
  - `diff ≤ 0`: one transaction takes the new seat (new enrollment `paid`), sets the old one to `transferred` and frees its seat. The ledger moves `target price` from the old enrollment to the new one (`transfer_out` / `transfer_in`), and a refund request for `−diff` is created against the **old** enrollment, whose balance then ends at 0.
  - `diff > 0`: the target seat is held 15 min as a `held` enrollment with `transfer_from_id` and price = `diff`. When it is paid, one transaction sets new → `paid`, old → `transferred`, frees the old seat and moves the whole credit. If it expires, the student simply stays in the old cohort.
- AS-20 **Refund percent** is based on `cancel time` against `cohort start` (= first lesson start) and `third lesson start`, as absolute instants computed from cohort-local wall times. Both boundaries are *strict*: at exactly the start instant → 50 %. Base = net paid. Rounding = floor to a minor unit, in the student's disfavour by at most 1 minor unit and never above net paid. With fewer than 3 lessons, "before the third lesson" means before the last lesson's end.
- AS-21 **Cancel statuses.** `held` / `offered` → `cancelled` (no money). `paid` with refund > 0 → `refunded` (seat freed immediately, refund delivered async). `paid` with refund 0 → `cancelled`.
- AS-22 **Manager exclusion** «исключает с возвратом»: refund by the rule by default. The manager may raise it to full (`refundPolicy: 'rule' | 'full'`), never above net paid. The status follows AS-21.
- AS-23 **One refund per enrollment** (`refund_requests.enrollment_id` unique), never above its balance. A transfer-difference refund belongs to the old, closed enrollment (AS-19). So the new enrollment still has its single refund available, and its refund base (net paid) = credit moved in + any surcharge.
- AS-24 **Refund delivery.** The refund request is created in the state-changing transaction (outbox). The `refunds` job POSTs to the stub with `Idempotency-Key = refund_request.id`. The refund `money_operation` is inserted on the first of (successful response, refund webhook), unique on `refund_request_id`. Retries: 8 attempts, exponential backoff from 2 s. After that it lands in `job_failures`.

**Schedule, reminders, homework, certificates**
- AS-25 **Lesson time.** Stored as cohort-local wall time (`local_date`, `local_time`) + cohort tz. `starts_at` (UTC) is derived by the shared function and stored. Default duration 90 min, set per cohort. Nonexistent local times (DST gap) shift forward to the first valid instant. Ambiguous ones (DST overlap) take the earlier offset. Both are tested. The library is luxon.
- AS-26 **Reminders.** One `scheduled_notifications` row per (lesson, kind, lesson version). On reschedule, `lessons.version` is incremented in the same transaction, old pending rows → `cancelled`, new rows inserted. Emails are deduplicated by `email_outbox.dedupe_key = reminder:{lessonId}:{version}:{kind}:{studentId}`. If a 24 h reminder was already sent and the lesson then moves, the new time gets its own new 24 h reminder (it is a different occurrence). Reminders whose due time is already past at creation are not sent, unless the lesson itself is still ahead and it is the 1 h kind.
- AS-27 **Email delivery** is at-least-once at the SMTP boundary. The outbox row is claimed with a lease (`sending`, `lease_until`) and marked `sent` after an SMTP 250. A crash between the 250 and the mark could resend. That window is documented in the README. The tests assert exactly one email in Mailpit under kill -9 *between* jobs, and in-job kills are covered by the lease.
- AS-28 **Homework.** One homework task per lesson, created with the lesson. Deadline = lesson's local date + 7 days at 23:59:59.999 cohort-local. Rescheduling moves it. A student may submit or resubmit while the status is `submitted` (replace, before review) or `returned`. Not while `in_review`, never after `accepted`. Resubmission is also allowed after the deadline and is flagged late. `is_late` is computed at every submit. "Grade" = mentor verdict + optional score 0–100 + comment.
- AS-29 **Files.** Stored in Postgres `bytea` (`submission_files`), at most 10 MB, MIME allowlist (pdf, zip, png, jpeg, txt, docx), sniffed by magic bytes. There is no object store in the stack, and both api copies need the same storage.
- AS-30 **Mentor claim.** `POST /mentor/queue/claim` takes the oldest `submitted` work in the mentor's cohorts (`FOR UPDATE SKIP LOCKED`) under a lock on the mentor's row, which caps concurrent reviews at 5 (`REVIEW_LIMIT_REACHED`). A mentor can release a claim. Reviewing is a claim, then accept or return. Releasing returns the work to `submitted` at its original queue position.
- AS-31 **Certificate.** Eligible = `accepted / homework count ≥ 0.8` at evaluation time, where "after the last lesson" = after the last lesson's end. The cohort-end sweep sets `paid` → `completed`, then enqueues `certificates` per enrollment. Accepting a submission in a finished cohort re-evaluates. The number comes from `course_certificate_counters` (row-locked `UPDATE … RETURNING`) in the same transaction as the insert, with `UNIQUE(course_id, number)` and `UNIQUE(enrollment_id)`, so a rollback leaves no gap. The PDF is rendered on download from db data. The public verification link is `/verify/{token}` with a random token of at least 240 bits. It is stored as is, so the student can open and share the link again later.

**Platform**
- AS-32 **Language.** README, UI and all docs in English. The assignment sets no language for them. UI is single-locale.
- AS-33 **Auth.** Email + password (argon2id). Access JWT for 15 min in an httpOnly `SameSite=Lax` cookie. Opaque refresh token rotating, with family reuse detection (reuse revokes the family). CSRF: Origin allowlist on mutating requests, plus `SameSite`. Socket.IO authenticates from the same cookie at handshake and re-checks room joins.
- AS-34 **Rate limiting** (optional hardening). Login and register: per IP and per account, Redis `INCR`+`EXPIRE` Lua, **fail-open** when Redis is down (logged), because availability of login matters more than throttling during an outage. Holds, checkout, webhooks, mentor, sockets: never throttled. The client IP is `X-Real-IP` set by nginx from `$remote_addr`, trusted only when the TCP peer is in `TRUSTED_PROXY_CIDRS`.
- AS-35 **Shared test clock.** `Clock` is injected everywhere. Business SQL takes `$now` from it and never calls `now()`. With `TEST_CLOCK_ENABLED=true`, the clock reads an offset from Postgres `test_clock` (shared by api copies and workers) and `POST /api/__test/clock` (header `X-Test-Token`) moves it. When disabled (the `.env.example` default), the route isn't registered. BullMQ delays use real time, so after a clock jump the **sweeper** (every `SWEEP_INTERVAL_MS`) catches due items from Postgres.
- AS-36 **Jobs and Redis loss.** Every job has a deterministic `jobId` and its effect is a guarded database transition, which makes it idempotent. The api and worker publish after commit, and the sweeper re-publishes everything due or pending from Postgres (holds, offers, notifications, refunds, reminders, certificates, emails). The sweeper is a plain timer in each worker, not a BullMQ repeatable job, so `FLUSHALL` cannot remove it. Several sweepers at once are harmless: same job ids, guarded effects.
- AS-37 **Realtime.** Socket.IO with `transports: ['websocket']`, so nginx needs no sticky sessions. Rooms: `catalog` (public, seat counts only), `user:{id}`, `mentor:{id}`, `cohort-staff:{id}` (the cohort's mentor or a manager of its school). Events: `seats.changed`, `roster.changed`, `queue.changed`. The api connects copies with the Redis adapter, and the worker publishes through the Redis emitter. Updates are best effort, and the UI refetches on reconnect.
- AS-38 **Seed scale.** `SEED_SCALE` (default `1`, the full numbers) multiplies the counts. Set-based SQL in one transaction, idempotent through a `seed_runs` marker. CI runs the clean start and speed budgets at `1`, e2e at `0.01` and acceptance at `0.05`. All seeded users share one argon2 hash of `SEED_DEMO_PASSWORD`, a published demo value (default `demo-password-2026`).
- AS-39 **Late flag in reports.** "Share of homework submitted on time" = submissions whose latest submission was not late / all submissions of tasks whose deadline is in the period.
- AS-40 **Waitlist conversion** = waitlist entries in the period that led to a paid enrollment / entries that received an offer.
- AS-41 **Report period** is in UTC days, filters are school-scoped. Query: `?from=YYYY-MM-DD&to=YYYY-MM-DD&courseId&cohortId&currency`. Revenue is shown per currency and never converted.
- AS-42 **API prefix.** REST under `/api`, Swagger UI on `/docs`, JSON on `/docs-json`, Socket.IO on `/socket.io`. Paystub UI through nginx at `/paystub/`, Mailpit UI at port `8025`.
- AS-43 **Node 22 LTS, pnpm 10**, TypeScript 5.9, NestJS 11, Prisma 6, Next 15.5, Postgres 16, Redis 7.4. Images are pinned by tag.
- AS-44 **`.env.example` runs as is.** Its secrets are working, clearly marked development-only placeholders, because «cp .env.example .env && docker compose up --build» must need no other step. Compose builds the in-network `DATABASE_URL`, `REDIS_URL` and SMTP host itself; the values in `.env` point at the published localhost ports for tests run from the host.
- AS-45 **Rounding.** A percent discount is rounded down (the price rounds up to the next minor unit). Refunds are rounded down. Prices are capped at 1,000,000,000 minor units.
- AS-46 **A cohort with no lessons** has its start at 00:00 cohort-local on the start date, with no third-lesson boundary (50 % after the start).
- AS-47 **Late payment status.** A late or unexpected payment that cannot be honoured moves an `expired` or `cancelled` enrollment to `refunded`.
- AS-48 **Returns of unwanted payments** (late and not honoured, duplicate, wrong amount) are separate refund requests tied to that payment (unique per payment). The «не больше одного раза» limit applies to the refund of the enrollment itself (cancel, exclusion, transfer difference), which is unique per enrollment. Both are capped by the balance in the database.
- AS-49 **Database guards.** Seat counters, promo counters, balances and certificate counters are written only by triggers from append-only history. A deferred trigger rejects any commit in which an enrollment's status and its seat journal disagree.
- AS-50 **Seed shape.** Bulk cohorts have 6 weekly lessons (so 100,000 certificates fit within 1,000,000 submissions); the cohorts with lessons around a DST change have 12. The full seed takes about 4 minutes on the host and 5–9 minutes inside Docker. The seed disables row guards only inside its own transaction, and the invariant checks verify the result.
- AS-51 **Registration is silent about taken addresses.** `POST /auth/register` answers 202 `{status: "accepted"}` whether or not the address exists; the client then signs in. Staff creation by an administrator does report `EMAIL_TAKEN`.
- AS-52 **Login limiter keys** are per client address and per (account, client address). There is no account-wide lockout, so nobody can lock another person out.
- AS-53 **Enrollment closes when the cohort starts.** The catalog lists cohorts whose first lesson is in the future. A lesson that has started cannot be moved, a lesson can only be moved to a future time, and a new cohort's first lesson must be in the future.
- AS-54 **Staff changes.** A mentor with unfinished cohorts cannot be disabled or turned into a manager until the cohorts are reassigned. Administrators are not managed through the API.
- AS-55 **Sessions.** An access token names its session (the refresh family), which is checked on every request. Logout, reuse of a refresh token and disabling an account end the session at once and close its sockets on every api copy. A changed role also closes the account's sockets.
- AS-56 **Writers settle the cohort first.** Every transaction that changes a cohort locks its row, expires overdue holds and offers, and offers free seats to waiters before doing its own work. A payment that arrives at or after the expiry instant is therefore always «late», whether or not the worker has run.
- AS-57 **Offer length near the start.** An offer lasts 24 hours, but never past the cohort start.
- AS-58 **A hold with a rejected promo code stands** at full price, and the response says why the code was not applied. A code cannot be applied to a transfer surcharge.
- AS-59 **One pending transfer per enrollment.** Asking again for the same target returns the pending surcharge hold. Cancelling the old enrollment cancels it. A surcharge paid after the old enrollment ended is returned.
- AS-60 **Transfer options** need the same course and currency and a target that has not started.
- AS-61 **Notification identity** is (school, event id); the first content wins. A payment is also unique by (school, provider payment id). A notification signed by one school cannot touch another school's enrollment.
- AS-62 **The payment stub** accepts refunds by refund id (idempotency key) and order id; it signs every delivery at send time.
- AS-63 **Anonymous sockets** may join only the public `catalog` room, which carries seat counts. Every other room needs the matching signed-in account, checked at the handshake and again at each join. (The skill asks to reject unauthenticated connections; the public catalog needs live updates for visitors.)
- AS-64 **Homework upload** is one multipart request (text and optional file). A resubmission keeps the earlier file unless a new one replaces it or the student removes it.
- AS-65 **Cohort completion** happens when the last lesson ends: paid enrollments become `completed`, open holds expire, waiting entries close. Each completed enrollment is marked due for a certificate; accepting homework afterwards marks it due again.
- AS-66 **Deadline reminders** go 24 hours before the deadline to enrolled students (`paid` or already `completed`) who have not handed the work in. A reminder is not sent once its lesson has started or its deadline has passed.
- AS-67 **Failed jobs** are recorded in Postgres on the last attempt. The sweeper leaves them alone until a manager retries them or the work succeeds another way.
- AS-68 **Chaos tests** wipe a Redis database of their own with `FLUSHDB`; the cross-stack acceptance suite uses `FLUSHALL`.
- AS-69 **Web rendering.** Pages are client components on TanStack Query; permissions are enforced by the API, and the page guards are a convenience. Any successful or failed mutation refetches the visible data.
- AS-70 **Generated client** (orval, TanStack Query, fetch) is committed and checked for drift in CI. Its transport adds one error type and a single-flight session refresh.
- AS-71 **Container network** is pinned to `10.213.47.0/24` (`COMPOSE_SUBNET`), so it cannot take a home router's address; only that range may set `X-Real-IP`.
- AS-72 **Acceptance runs.** A-1 and the speed budgets run on the stack started exactly from `.env.example`. The behaviour checks run on the test profile (movable clock). Checks that move the clock far use past dates, so nothing in the seeded data becomes due.
- AS-73 **Search and report speed** use a trigger-maintained `school_students` table and covering indexes.
- AS-74 **Transfers and refunds.** A student may transfer only before their own cohort starts; afterwards a manager decides. A transfer carries the refund percentage the old enrollment still had (at the moment the move happens) as a cap on later cancellations, so moving cohorts never restores it. A surcharge paid late, after the old cohort started, is returned. A manager's «Everything paid» exclusion ignores the cap.
- AS-75 **Free cohorts** enroll at once, without a payment page; no promo code is spent.
- AS-76 **A mentor who stops mentoring** (disabled or made a manager) has their open reviews returned to the queue. Reassigning a cohort while the mentor stays active leaves the review with them.
- AS-77 **Outages and restarts.** With Postgres unreachable the api answers 503. A stopping api copy first stops listening, so nginx turns to the other copy, then serves its open connections until they have been quiet for a second (7 s at most).

<!-- /generated:decisions -->

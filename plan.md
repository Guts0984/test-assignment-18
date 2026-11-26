# plan.md — Online school with course cohorts

Status: **Phase 1 — building** (approved 2026-11-26). The checklist in §9 is the resume point.

Sources of truth, in priority order: `ASSIGNMENT.md` (Russian, never edited) → this plan → `CLAUDE.md` → `.claude/skills/adversarial-testing/SKILL.md` → defaults.

Glossary (assignment term → code term): курс → `course`, поток → `cohort`, занятие → `lesson`, запись → `enrollment`, бронь → `hold`, лист ожидания → `waitlist`, предложение → `offer`, домашка → `homework` (task) / `submission` (student work), журнал мест → `seat_journal`, школа → `school`, заглушка платёжной системы → `paystub`, почтовый ящик → `mailpit`.

---

## 1. Requirements matrix

Legend for the **Block** column: commit numbers from §8 (C1…C8).
Test paths are relative to the repo root. `it:` = integration test (real Postgres and Redis), `adv:` = adversarial real-server test, `x:` = cross-stack test through nginx with two api copies, `e2e:` = Playwright, `unit:` = Vitest unit or property test.

### 1.1 Stack (Стек)

| ID | Requirement (RU quote → EN) | Block | Test |
|---|---|---|---|
| ST-1 | «PostgreSQL 16 + Prisma; сырой SQL там, где нужны блокировки, ограничения и отчёты. Источник правды — Postgres» → Postgres 16 with Prisma; raw SQL for locks, constraints and reports; Postgres is the source of truth | C2 | it: `packages/db/test/constraints.it.spec.ts`; adv: `apps/api/test/adv/redis-loss.adv.spec.ts` |
| ST-2 | «Redis 7 — BullMQ: истечение брони места, предложения из листа ожидания, приём уведомлений от платёжной системы, возвраты, напоминания о занятиях и дедлайнах, сертификаты, письма» → BullMQ queues for hold expiry, waitlist offers, payment notification intake, refunds, lesson and deadline reminders, certificates, emails | C5 | it: `apps/worker/test/queues.it.spec.ts` (each queue named and processed) |
| ST-3 | «Адаптер Socket.IO между копиями api» → Socket.IO Redis adapter across api copies | C5, C7 | adv: `apps/api/test/adv/realtime.adv.spec.ts`; x: `tests/cross-stack/realtime-multicopy.x.spec.ts` |
| ST-4 | «При потере данных Redis ничего не теряется» → losing Redis data loses nothing | C5 | adv: `apps/worker/test/adv/flushall.adv.spec.ts` |
| ST-5 | «NestJS: REST + OpenAPI (@nestjs/swagger), Socket.IO (@nestjs/websockets). В docker compose работают две копии за nginx» → NestJS REST + Swagger + Socket.IO gateway; two api copies behind nginx | C3, C7 | it: `apps/api/test/openapi.it.spec.ts`; x: `tests/cross-stack/smoke.x.spec.ts` (both copies answer, `X-Instance` header) |
| ST-6 | «apps/worker — отдельный процесс NestJS с обработчиками BullMQ. Можно запустить несколько копий» → separate NestJS worker process, can run several copies | C5 | adv: `apps/worker/test/adv/multi-worker.adv.spec.ts` |
| ST-7 | «Next.js 15 (App Router), React 19. Клиент API генерируется из OpenAPI; TanStack Query, React Hook Form, Tailwind» → Next 15 App Router, React 19, generated client, TanStack Query, RHF, Tailwind | C6 | CI step `gen:client && git diff --exit-code`; unit: `apps/web/src/**/*.spec.ts` |
| ST-8 | «packages/shared — Zod-схемы ввода, расписание занятий в часовом поясе потока, дедлайны, сумма возврата, условие сертификата, переходы статусов» → shared zod input schemas, schedule in cohort tz, deadlines, refund amount, certificate condition, status transitions | C1 | unit: `packages/shared/src/**/*.spec.ts` |
| ST-9 | «Тесты: Vitest; интеграционные — на настоящих Postgres и Redis; e2e — Playwright» → Vitest, real Postgres/Redis integration, Playwright e2e | C1…C7 | CI jobs `unit`, `integration`, `e2e` |

### 1.2 Scenarios (Сценарии)

| ID | Requirement (RU quote → EN) | Block | Test |
|---|---|---|---|
| SC-S1 | «Ищет курс в каталоге по названию, направлению, дате старта и цене. Видит потоки с числом свободных мест» → catalog search by title, direction, start date, price; shows cohorts with free seats | C3 | it: `apps/api/src/modules/catalog/catalog.it.spec.ts`; e2e: `apps/web/e2e/enroll-pay.e2e.ts` |
| SC-S2 | «Записывается на поток: место держится за ним 15 минут, пока он оплачивает (на экране обратный отсчёт). Может применить промокод» → enrolling holds the seat 15 min with an on-screen countdown; promo code may be applied | C4, C6 | it: `apps/api/src/modules/enrollments/holds.it.spec.ts`; unit: `apps/web/src/features/hold-countdown/model/countdown.spec.ts`; e2e: `enroll-pay.e2e.ts` |
| SC-S3 | «Если мест нет, встаёт в лист ожидания. Когда место освобождается, получает письмо с предложением: у него 24 часа, чтобы оплатить» → join waitlist when full; on a freed seat, email offer with 24 h to pay | C4, C5 | it: `waitlist.it.spec.ts`; adv: `waitlist.race.adv.spec.ts`; e2e: `waitlist.e2e.ts` |
| SC-S4 | «В личном кабинете видит расписание занятий в своём часовом поясе, домашние задания и дедлайны, оценки ментора и прогресс» → cabinet: schedule in own tz, homework, deadlines, mentor grades, progress | C5, C6 | it: `apps/api/src/modules/cabinet/cabinet.it.spec.ts`; unit: `packages/shared/src/schedule/display.spec.ts`; e2e: `homework-cert.e2e.ts` |
| SC-S5 | «Сдаёт домашку (текст и файл), может пересдать до дедлайна. Видит комментарий ментора» → submit text + file, resubmit before deadline, see mentor comment | C5 | it: `submissions.it.spec.ts`; e2e: `homework-cert.e2e.ts` |
| SC-S6 | «Просит перевод в другой поток того же курса или отменяет участие. Перед отменой видит, сколько денег вернётся» → request transfer to another cohort of the same course, or cancel; refund amount preview before cancel | C4 | it: `transfers.it.spec.ts`, `cancel.it.spec.ts` (preview equals actual refund); e2e: `transfer-cancel.e2e.ts` |
| SC-S7 | «После окончания потока скачивает сертификат, если выполнил условие» → download certificate after cohort end if condition met | C5 | it: `certificates.it.spec.ts`; e2e: `homework-cert.e2e.ts` |
| SC-M1 | «Видит очередь домашек на проверку: сначала самые старые. Одновременно на проверке у ментора не больше 5 работ» → review queue oldest-first; max 5 in review per mentor | C5 | it: `mentor-queue.it.spec.ts`; adv: `mentor-claim.race.adv.spec.ts` (20 parallel claims → 5) |
| SC-M2 | «Принимает работу или возвращает на доработку с комментарием» → accept, or return with comment | C5 | it: `review.it.spec.ts` |
| SC-M3 | «Видит своих студентов и их прогресс» → mentor sees own students and progress | C5 | it: `mentor-students.it.spec.ts`; adv: `idor.adv.spec.ts` |
| SC-MG1 | «Создаёт курсы, потоки (дата старта, часовой пояс, число мест, цена, ментор) и расписание: «по вторникам и четвергам в 19:00 по Киеву, 12 занятий»» → create courses, cohorts (start, tz, capacity, price, mentor) and recurring schedule | C3 | unit: `packages/shared/src/schedule/generate.spec.ts`; it: `cohorts.it.spec.ts` |
| SC-MG2 | «Переносит отдельное занятие на другое время» → reschedule a single lesson | C3, C5 | it: `lessons.reschedule.it.spec.ts`; adv: `reminders.adv.spec.ts` |
| SC-MG3 | «Создаёт промокоды: скидка, число использований, срок действия» → promo codes: discount, max uses, validity window | C4 | it: `promos.it.spec.ts`; unit: `packages/shared/src/pricing/promo.spec.ts` |
| SC-MG4 | «Видит студентов потока, лист ожидания, оплаты и возвраты. Переводит студента в другой поток или исключает его с возвратом» → cohort students, waitlist, payments, refunds; transfer or exclude with refund | C4 | it: `manager-cohort.it.spec.ts`, `exclude.it.spec.ts` |
| SC-MG5 | «Видит упавшие фоновые задачи и запускает их повторно» → see failed jobs and retry them | C5 | adv: `failed-jobs.adv.spec.ts` |
| SC-A1 | «Управляет сотрудниками и их ролями: менеджер, ментор» → admin manages staff and roles (manager, mentor) | C3 | it: `staff.it.spec.ts`; adv: `route-sweep.adv.spec.ts` |
| SC-A2 | «Подключает платёжную систему: адрес, ключ» → admin configures payment gateway URL and key | C4 | it: `gateway-config.it.spec.ts` (key encrypted at rest, never returned) |

### 1.3 Rules table (Правила)

| ID | Requirement (RU quote → EN) | Block | Test |
|---|---|---|---|
| R-SEATS | «оплаченные + удерживаемые + предложенные из листа ожидания ≤ число мест. Менеджер может увеличить число мест, но не уменьшить ниже уже занятых» → paid + held + offered ≤ capacity; capacity can grow, never below taken | C2, C4 | it: `packages/db/test/constraints.it.spec.ts` (CHECK fires); it: `capacity.it.spec.ts`; adv: `last-seats.race.adv.spec.ts` |
| R-HOLD-1 | «Бронь места: 15 минут» → hold lasts 15 min | C4 | it: `holds.it.spec.ts` (TTL−1 s still held, TTL expired, TTL+1 s) |
| R-HOLD-2 | «Истёкшая бронь возвращает место ровно один раз» → expired hold returns the seat exactly once | C4, C5 | adv: `expiry-once.adv.spec.ts` (expire job ×10 parallel + sweeper) |
| R-HOLD-3 | «Оплата, пришедшая после истечения: если место ещё есть — студент записан, если нет — деньги возвращаются автоматически. Деньги без места не остаются никогда» → late payment: enrol if seat free, else auto-refund; never money without a seat | C4 | adv: `late-payment.adv.spec.ts`; e2e: `late-payment-refund.e2e.ts` |
| R-WAIT-1 | «очередь по времени записи» → FIFO by join time | C4 | it: `waitlist.it.spec.ts` |
| R-WAIT-2 | «Освободившееся место предлагается первому в очереди на 24 часа; если он не оплатил, место переходит к следующему» → freed seat offered to the first for 24 h, then moves to the next | C4, C5 | adv: `waitlist.race.adv.spec.ts` |
| R-WAIT-3 | «Одно место — одно предложение» → one seat, one offer | C4 | adv: `waitlist.race.adv.spec.ts` (offers count = freed seats) |
| R-PRICE-1 | «Цена фиксируется в момент брони места» → price is fixed at hold time | C4 | it: `pricing.it.spec.ts` (manager changes price after hold; held price unchanged) |
| R-PRICE-2 | «Промокод уменьшает цену; число использований промокода не превышает лимит даже при одновременных оплатах» → promo lowers price; uses never exceed limit under concurrency | C4 | adv: `promo.race.adv.spec.ts` |
| R-PRICE-3 | «Бронь, которая истекла или не оплачена, промокод не тратит» → expired or unpaid hold does not consume a promo use | C4 | it: `promos.it.spec.ts` (reserve → expire → reservation released) |
| R-TRANSFER | «в другой поток того же курса, если там есть место: новое место занимается и старое освобождается в одной транзакции. Разница в цене доплачивается или возвращается» → transfer within the course only if seat; take new and free old in one tx; price difference charged or refunded | C4 | adv: `transfer.race.adv.spec.ts`; it: `transfers.it.spec.ts`; e2e: `transfer-cancel.e2e.ts` |
| R-REFUND-1 | «до старта потока — 100 %; до начала третьего занятия — 50 %; позже — без возврата» → 100 % before start, 50 % before lesson 3 starts, 0 % after | C1 | unit: `packages/shared/src/refund/refund.spec.ts` (boundaries ±1 s, property tests) |
| R-REFUND-2 | «Время сравнивается по часовому поясу потока» → compared in cohort tz | C1 | unit: `refund.spec.ts` (America/New_York, DST) |
| R-REFUND-3 | «Возврат по одной записи — не больше одного раза и не больше оплаченного» → at most one refund per enrollment and never more than paid | C2, C4 | it: `packages/db/test/constraints.it.spec.ts`; adv: `double-refund.race.adv.spec.ts` |
| R-SCHED-1 | «занятия задаются по местному времени потока и не сдвигаются при переходе на летнее время» → lessons are defined in cohort local time and do not shift across DST | C1 | unit: `packages/shared/src/schedule/generate.spec.ts` (Kyiv 2026-03-29, Warsaw, New York 2026-03-08 / 2026-11-01) |
| R-SCHED-2 | «Студент видит их в своём часовом поясе» → student sees them in own tz | C1, C6 | unit: `display.spec.ts`; e2e: `homework-cert.e2e.ts` |
| R-REMIND-1 | «письмо за 24 часа и за 1 час до занятия, ровно одно каждого вида» → email 24 h and 1 h before, exactly one of each kind | C5 | adv: `reminders.adv.spec.ts` |
| R-REMIND-2 | «После переноса занятия старые напоминания не приходят, новые — по новому времени» → after reschedule old reminders never arrive, new ones follow new time | C5 | adv: `reminders.adv.spec.ts` (reschedule 30 min before reminder) |
| R-HW-1 | «дедлайн — 23:59 по часовому поясу потока через 7 дней после занятия» → deadline 23:59 cohort-local, 7 days after the lesson | C1 | unit: `packages/shared/src/homework/deadline.spec.ts` |
| R-HW-2 | «Работа, сданная после дедлайна, принимается с отметкой «поздно»» → late work accepted with a "late" flag | C5 | it: `submissions.it.spec.ts` |
| R-HW-3 | «У одной работы в любой момент не больше одного проверяющего» → one reviewer per submission at any time | C2, C5 | adv: `mentor-claim.race.adv.spec.ts` |
| R-CERT-1 | «выдаётся после последнего занятия, если принято не меньше 80 % домашек» → issued after the last lesson if ≥ 80 % homework accepted | C1, C5 | unit: `packages/shared/src/certificate/eligibility.spec.ts` (79.9 % / 80 %); it: `certificates.it.spec.ts` |
| R-CERT-2 | «Номер сквозной по курсу, без пропусков и повторов» → per-course sequential number, no gaps, no repeats | C2, C5 | adv: `certificates.adv.spec.ts` |
| R-CERT-3 | «Выдаётся ровно один раз» → issued exactly once | C2, C5 | adv: `certificates.adv.spec.ts` |
| R-MONEY-1 | «в минорных единицах валюты потока (UAH, EUR, USD)» → minor units of the cohort currency | C1, C2 | unit: `packages/shared/src/money/money.spec.ts`; adv: `input.adv.spec.ts` (float price → 400) |
| R-MONEY-2 | «Оплаты и возвраты не удаляются и не меняются; баланс записи равен сумме её операций» → payments/refunds are immutable; enrollment balance = sum of its operations | C2 | it: `packages/db/test/ledger.it.spec.ts` (UPDATE/DELETE blocked by trigger); `assertInvariants()` after every adv test |
| R-STATUS-E | «Статусы записи: held, offered, paid, transferred, cancelled, refunded, expired, completed» → enrollment statuses | C1, C2 | unit: `packages/shared/src/status/enrollment.spec.ts` (every pair allowed/forbidden); it: DB CHECK |
| R-STATUS-H | «Статусы домашки: submitted, in_review, accepted, returned» → submission statuses | C1, C2 | unit: `packages/shared/src/status/submission.spec.ts` |
| R-STATUS-README | «Таблицы переходов (кто и из какого статуса) — в README» → transition tables in README | C8 | `scripts/check-readme-transitions.ts` (README tables generated from and diffed against shared transition maps, run in CI) |
| R-JOURNAL-1 | «каждое изменение занятости потока (бронь, оплата, истечение, предложение из листа ожидания, перевод, отмена, исключение, изменение числа мест) — отдельная запись: поток, на сколько, по какой записи, кто, когда» → every occupancy change is a journal row: cohort, delta, enrollment, actor, time | C2, C4 | it: `seat-journal.it.spec.ts` (each reason produces exactly one row) |
| R-JOURNAL-2 | «Счётчики мест по каждому потоку всегда равны сумме журнала» → counters always equal the journal sum | C2 | `assertInvariants()`; it: `packages/db/test/constraints.it.spec.ts` |

### 1.4 Seed (Сид)

| ID | Requirement (RU quote → EN) | Block | Test |
|---|---|---|---|
| SEED-1 | «200 курсов, 2 000 потоков в трёх часовых поясах (Europe/Kyiv, Europe/Warsaw, America/New_York) и трёх валютах, за 2 года и на полгода вперёд» → 200 courses, 2,000 cohorts, 3 tz, 3 currencies, 2 years back to 6 months ahead | C2 | it: `packages/db/test/seed.it.spec.ts` (counts, distributions; run at `SEED_SCALE=1` in the e2e CI job) |
| SEED-2 | «300 000 студентов, 500 000 записей, из них часть отменена, возвращена или переведена» → 300k students, 500k enrollments, some cancelled/refunded/transferred | C2 | same |
| SEED-3 | «1 000 000 домашек в разных статусах, 100 000 сертификатов» → 1M submissions in all statuses, 100k certificates | C2 | same, plus `assertInvariants()` on the seeded db |
| SEED-4 | «несколько потоков, которые стартуют в ближайшие дни с последними свободными местами и листом ожидания» → several cohorts starting soon with last seats and a waitlist | C2 | same |
| SEED-5 | «несколько потоков с занятиями на неделе перехода на летнее время» → several cohorts with lessons in DST week | C2 | same |
| SEED-6 | «Логины — в README» → logins in README | C8 | `scripts/check-readme-logins.ts` logs in with every README login against the compose stack |

### 1.5 Payment stub (Заглушка платёжной системы)

| ID | Requirement (RU quote → EN) | Block | Test |
|---|---|---|---|
| PS-1 | «Отдельный сервис в docker compose» → separate compose service | C4, C7 | x: `smoke.x.spec.ts` |
| PS-2 | «страница оплаты: кнопки «оплатить», «отказ», «закрыть без оплаты»» → pay page with pay / decline / close-without-paying | C4 | it: `apps/paystub/test/pay-page.it.spec.ts`; e2e: `enroll-pay.e2e.ts` |
| PS-3 | «уведомляет сервис об оплате и возврате подписанным запросом (HMAC), повторяет при ошибке» → HMAC-signed payment/refund notifications, retried on error | C4 | it: `apps/paystub/test/delivery.it.spec.ts` (api returns 500 ×3 → delivered on retry); adv: `webhook.adv.spec.ts` (bad signature, replay, stale timestamp) |
| PS-4 | «принимает запросы на возврат, показывает все оплаты и возвраты» → accepts refund requests; lists all payments and refunds | C4 | it: `apps/paystub/test/refunds.it.spec.ts` |
| PS-5 | «режим хаоса (переключатель в .env)» → chaos switch in .env | C4 | it: `apps/paystub/test/chaos.it.spec.ts` |
| PS-6 | «уведомление об оплате отправляется дважды, одновременно в обе копии api» → payment notification sent twice concurrently to both api copies | C4 | x: `tests/cross-stack/chaos-payments.x.spec.ts` |
| PS-7 | «уведомление об оплате иногда приходит через 20 минут, когда бронь места уже истекла» → sometimes delivered 20 min later | C4 | it: `chaos.it.spec.ts` (delay scheduled = 1,200 s; control endpoint releases it); adv: `late-payment.adv.spec.ts` |
| PS-8 | «уведомление о возврате иногда приходит раньше ответа на запрос возврата» → refund notification sometimes before the refund response | C4 | adv: `refund-chaos.adv.spec.ts` |
| PS-9 | «каждый пятый запрос на возврат получает ответ 500 или таймаут» → every 5th refund request gets 500 or timeout | C4 | it: `chaos.it.spec.ts`; adv: `refund-chaos.adv.spec.ts` |

### 1.6 Invariants (Инварианты)

«Каждый инвариант должен держаться при одновременных запросах, повторах, рестарте процессов и потере Redis, и на каждый нужен тест.» → each invariant must hold under concurrency, retries, process restarts and Redis loss, each with a test. All adv tests below loop ≈20 iterations and end with `assertInvariants()`.

| ID | Requirement (RU quote → EN) | Block | Test |
|---|---|---|---|
| INV-1 | «Мест не больше, чем есть… счётчики всегда равны сумме журнала» → never over capacity; counters = journal sum | C2, C4 | adv: `last-seats.race.adv.spec.ts`, `assertInvariants()` everywhere |
| INV-2 | «200 одновременных записей на 5 последних мест через обе копии api — ровно 5 броней, остальные получают «мест нет» и могут встать в лист ожидания» → 200 concurrent on last 5 via both copies → exactly 5 holds, rest `NO_SEATS` and may join the waitlist | C4, C7 | adv: `last-seats.race.adv.spec.ts` (two in-process app copies); x: `last-seats.x.spec.ts` (via nginx) |
| INV-3 | «Оплата, пришедшая в момент истечения брони, — либо студент записан, либо место вернулось и деньги возвращены; никогда оба и никогда ни одного» → payment at the expiry instant: enrolled XOR (seat freed AND refunded) | C4, C5 | adv: `expiry-vs-payment.race.adv.spec.ts` |
| INV-4 | «Освободились 3 места одновременно — предложения получили ровно трое первых, каждый одно. Непринятое предложение переходит к следующему один раз» → 3 freed at once → first three get one offer each; unpaid offer passes on once | C4, C5 | adv: `waitlist.race.adv.spec.ts` |
| INV-5 | «50 одновременных оплат с промокодом на 10 использований — скидку получили ровно 10» → 50 concurrent with a 10-use promo → exactly 10 discounts | C4 | adv: `promo.race.adv.spec.ts` |
| INV-6 | «Перевод в поток, где одновременно занимают последнее место, — либо студент в новом потоке и старое место свободно, либо остался в старом» → transfer racing for the last seat ends in exactly one cohort | C4 | adv: `transfer.race.adv.spec.ts` |
| INV-7a | «Одно уведомление 10 раз в обе копии api — одна оплата» → same notification ×10 to both copies → one payment | C4 | adv: `duplicate-webhook.race.adv.spec.ts`; x: `chaos-payments.x.spec.ts` |
| INV-7b | «Возврат при ошибках платёжной системы доходит после повторов, вернули ровно один раз и не больше оплаченного» → refund succeeds after retries, exactly once, ≤ paid | C4, C5 | adv: `refund-chaos.adv.spec.ts` |
| INV-7c | «Отмена студентом и исключение менеджером одновременно — один возврат» → concurrent student cancel + manager exclude → one refund | C4 | adv: `double-refund.race.adv.spec.ts` |
| INV-8 | «Напоминания — ровно одно каждого вида и вовремя. Включая неделю перехода на летнее время и перенос занятия за 30 минут до напоминания» → one reminder of each kind, on time, incl. DST week and reschedule 30 min before | C5 | adv: `reminders.adv.spec.ts` |
| INV-9 | «При нескольких копиях worker, kill -9 посреди выдачи и потере Redis каждый студент получил не больше одного сертификата, номера по курсу идут подряд» → multi-worker, kill -9 and Redis loss → ≤ 1 certificate each, consecutive numbers | C5 | adv: `certificates.adv.spec.ts` |
| INV-10a | «kill -9 воркера посреди истечения броней или выдачи сертификатов — после рестарта всё доделано без двойного учёта» → kill -9 mid-expiry or mid-certificates → finished after restart, no double counting | C5 | adv: `worker-kill.adv.spec.ts` |
| INV-10b | «несколько копий worker не выполняют одну задачу дважды» → several workers never run one job twice (effect-wise) | C5 | adv: `multi-worker.adv.spec.ts` |
| INV-10c | «задача, исчерпавшая попытки, видна менеджеру и запускается повторно вручную» → exhausted job visible to manager and retryable manually | C5 | adv: `failed-jobs.adv.spec.ts` (also survives FLUSHALL) |
| INV-11 | «После FLUSHALL брони и предложения истекают, напоминания приходят, возвраты доходят, и ничего не выполняется дважды» → after FLUSHALL holds/offers expire, reminders arrive, refunds land, nothing twice | C5 | adv: `flushall.adv.spec.ts` |
| INV-12a | «студент видит только свои записи, домашки и сертификаты» → student sees only own enrollments, submissions, certificates | C3–C5 | adv: `idor.adv.spec.ts` |
| INV-12b | «ментор — только своих студентов и их работы» → mentor only own students and work | C5 | adv: `idor.adv.spec.ts` |
| INV-12c | «менеджер — только свою школу» → manager only own school | C3–C5 | adv: `idor.adv.spec.ts`, `route-sweep.adv.spec.ts` (cross-school matrix) |
| INV-12d | «ключ платёжной системы работает только для уведомлений» → gateway key works only for notifications | C4 | adv: `webhook.adv.spec.ts` (key as Bearer / HMAC on other routes → 401) |
| INV-12e | «сертификат проверяется по публичной ссылке, но ссылку нельзя подобрать» → public verification link, unguessable | C5 | adv: `certificate-link.adv.spec.ts` (256-bit token, sequential numbers / ids don't resolve, 1,000 random tokens → 404, timing-flat) |
| INV-12f | «на некорректный ввод — понятная ошибка с кодом, одинаковая по формату во всех эндпоинтах и описанная в OpenAPI; никогда «Internal server error»» → clear coded error, same shape everywhere, in OpenAPI, never a bare 500 | C3 | adv: `input.adv.spec.ts` (table per endpoint group); it: `openapi.it.spec.ts` (every operation declares the `ApiError` schema) |
| INV-12g | «Права — на сервере, в каждом эндпоинте и в сокетах» → enforced server-side on every endpoint and socket | C3, C5 | adv: `route-sweep.adv.spec.ts`, `realtime.adv.spec.ts` |
| INV-TIME | «Время в задачах (15 минут брони, 24 часа предложения, напоминания, дедлайны, границы возврата) подменяется в тестах» → time is substitutable in tests | C1, C3, C5 | unit: `packages/shared/src/clock/clock.spec.ts`; it: `test-clock.it.spec.ts` (endpoint refused when disabled or with a wrong token) |

### 1.7 Deliverables (Что сдать)

| ID | Requirement (RU quote → EN) | Block | Test |
|---|---|---|---|
| D-1 | «Репозиторий: apps/api, apps/worker, apps/web, packages/shared» → repo layout | C1 | CI `typecheck` over the workspace |
| D-2 | «cp .env.example .env && docker compose up --build» → one-command start | C7 | `scripts/acceptance/01-compose-up.sh` (clean clone → healthy within timeout) |
| D-3 | «docker compose: postgres, redis, api ×2, nginx, worker, web, заглушка платёжной системы, почтовый ящик для писем» → services list | C7 | `scripts/acceptance/01-compose-up.sh` asserts every service is healthy |
| D-4 | «Миграции и сид создаются сами, других ручных шагов нет» → migrations and seed run automatically | C7 | same script, then `seed.it.spec.ts` counts against the stack |
| D-5 | «Swagger на /docs; сгенерированный клиент совпадает со схемой — проверка в CI» → Swagger on `/docs`; client matches schema, checked in CI | C3, C6 | x: `smoke.x.spec.ts` (`GET /docs` 200); CI `client-drift` step |
| D-6 | «Кабинет студента работает с телефона (ширина 375 px)» → student cabinet works at 375 px | C6 | e2e: `mobile-375.e2e.ts` (no horizontal scroll, all actions reachable) |
| D-7 | «Свободные места в каталоге, очередь ментора и список студентов потока у менеджера обновляются вживую» → catalog free seats, mentor queue, manager cohort list update live | C5, C6 | x: `realtime-multicopy.x.spec.ts`; e2e: `enroll-pay.e2e.ts` |
| D-8 | «обратный отсчёт брони считается по часам сервера» → hold countdown uses the server clock | C4, C6 | unit: `countdown.spec.ts` (skewed client clock still shows server remaining time) |
| D-9 | «Формы с ошибками у полей» → forms show errors at fields | C6 | unit: `apps/web/src/shared/lib/form/map-api-errors.spec.ts`; e2e: `forms.e2e.ts` |
| D-10 | «поиск в каталоге — быстрее 200 мс; очередь ментора — быстрее 200 мс; поиск студента по имени и email — быстрее 300 мс; отчёт за 12 месяцев — быстрее 1 с» → latency budgets | C2, C7 | `tests/perf/budgets.perf.spec.ts` on the full seed (p95 over 50 runs, through nginx) |
| D-11 | «Отчёт для менеджера: заполняемость потоков, выручка и возвраты, конверсия листа ожидания, доля сданных вовремя домашек, выданные сертификаты. Период и фильтры — в URL» → manager report with five metrics; period and filters in URL | C5, C6 | it: `reports.it.spec.ts` (numbers vs hand-computed fixture); e2e: `report-url.e2e.ts` |
| D-E2E-1 | «студент находит курс → бронь места → оплата → письмо → место в каталоге уменьшилось вживую» | C7 | e2e: `enroll-pay.e2e.ts` |
| D-E2E-2 | «мест нет → лист ожидания → другой студент отменил → предложение → оплата» | C7 | e2e: `waitlist.e2e.ts` |
| D-E2E-3 | «бронь истекла → оплата пришла поздно, места нет → автоматический возврат» | C7 | e2e: `late-payment-refund.e2e.ts` |
| D-E2E-4 | «домашка → ментор вернул на доработку → пересдача → принята → после последнего занятия сертификат» | C7 | e2e: `homework-cert.e2e.ts` |
| D-E2E-5 | «перевод в другой поток с доплатой; отмена после старта → возврат 50 %» | C7 | e2e: `transfer-cancel.e2e.ts` |
| D-README-1 | «README: запуск и тесты» | C8 | `scripts/check-readme.ts` (required headings present) |
| D-README-2 | «как считаются места и почему нельзя продать лишнее, включая лист ожидания и перевод» | C8 | same |
| D-README-3 | «как защищены бронь, оплата, возврат и перевод от одновременных действий и повторов» | C8 | same |
| D-README-4 | «как считаются расписание, напоминания и дедлайны в часовых поясах, с примером на переходе на летнее время» | C8 | same; the DST example is copied from a passing unit test's fixture |
| D-README-5 | «список фоновых задач: когда ставятся, повторы, защита от дублей, восстановление после потери Redis» | C8 | same; the job list is diffed against the queue registry in `packages/shared/src/jobs/registry.ts` |
| D-README-6 | «таблицы статусов записи и домашки» | C8 | `check-readme-transitions.ts` |
| D-README-7 | «индексы и ограничения в базе» | C8 | `scripts/check-readme-db.ts` (every index/constraint in `pg_catalog` is listed) |
| D-README-8 | «принятые решения» | C8 | manual: §3 of this plan copied verbatim, checked by `check-readme.ts` (each assumption ID appears) |
| D-AMBIG | «Если что-то неоднозначно, решите сами и запишите решение в README» | C8 | as D-README-8 |
| D-GIT | «История коммитов — по этапам работы, CI на каждый коммит» → staged history, CI on every commit | C1…C8 | `.github/workflows/ci.yml` from C1; `git log` review |

### 1.8 Acceptance checks (Приёмка) — the assignment has 17

| ID | Check (RU quote → EN) | Expected | Block | Test |
|---|---|---|---|---|
| A-1 | «cp .env.example .env && docker compose up --build» | everything up, no manual steps | C7 | `scripts/acceptance/01-compose-up.sh` |
| A-2 | «Typecheck, lint, сгенерированный клиент без изменений, тесты, CI» | pass on every commit | C1… | CI; `scripts/acceptance/02-ci-local.sh` runs the same steps |
| A-3 | «200 одновременных записей на 5 последних мест, обе копии api» | exactly 5 holds, journal matches | C7 | x: `tests/acceptance/a03-last-seats.x.spec.ts` |
| A-4 | «Оплата в момент истечения брони (в цикле)» | enrolled or refunded; seats match | C7 | x: `a04-expiry-vs-payment.x.spec.ts` |
| A-5 | «Освободились 3 места одновременно; предложение не оплачено за 24 часа» | offers to first three, then the fourth, once each | C7 | x: `a05-waitlist.x.spec.ts` |
| A-6 | «50 одновременных оплат с промокодом на 10 использований» | exactly 10 discounted | C7 | x: `a06-promo.x.spec.ts` |
| A-7 | «Перевод в поток, где одновременно занимают последнее место» | student in exactly one cohort | C7 | x: `a07-transfer.x.spec.ts` |
| A-8 | «Уведомление об оплате 10 раз в обе копии api; режим хаоса» | one payment; all refunds landed, none repeated | C7 | x: `a08-chaos.x.spec.ts` (stack restarted with `PAYSTUB_CHAOS_MODE=true`) |
| A-9 | «Отмена за 1 минуту до старта и через 1 минуту после, по Нью-Йорку» | 100 % and 50 % | C7 | x: `a09-refund-ny.x.spec.ts` |
| A-10 | «Занятие в 19:00 по Киеву на неделе перехода на летнее время; перенос занятия за 30 минут до напоминания» | lesson at 19:00 Kyiv; one reminder of each kind at the new time | C7 | x: `a10-dst-reminders.x.spec.ts` |
| A-11 | «Воркеры остановлены, часы сдвинуты на конец потока, две копии worker запущены» | certificates one each, numbers consecutive | C7 | x: `a11-certificates.x.spec.ts` |
| A-12 | «kill -9 воркера при истечении броней; redis-cli FLUSHALL при идущих бронях» | all done, no double counting | C7 | x: `a12-kill-flush.x.spec.ts` |
| A-13 | «Журнал мест против счётчиков; оплаты и возвраты против балансов записей — после всех проверок» | match for every cohort and enrollment | C7 | x: `a13-reconcile.x.spec.ts` (runs last, over the whole db) |
| A-14 | «Менеджер на копии A, запись студента через копию B» | cohort list and catalog seats update in < 1 s | C7 | x: `a14-realtime.x.spec.ts` |
| A-15 | «Чужая запись, чужие домашки ментором, чужая школа, подобранная ссылка на сертификат — прямыми запросами и через сокет» | refused | C7 | x: `a15-authz.x.spec.ts` |
| A-16 | «Каталог, очередь ментора, отчёт за 12 месяцев; перезагрузка, «Назад»» | fast; state from URL | C7 | `tests/perf/budgets.perf.spec.ts` + e2e: `a16-url-state.e2e.ts` |
| A-17 | «README» | matches behavior | C8 | `scripts/check-readme*.ts` + manual review recorded in §9 |

Runner: `pnpm acceptance` runs A-1…A-17 in order against the compose stack and writes `docs/ACCEPTANCE.md` (check, result, duration, evidence). Results are copied into §9.

---

## 2. Deviations

| # | Source says | Assignment says / reality | Resolution |
|---|---|---|---|
| DV-1 | The prompt asks for "all 20 acceptance checks". | The «Приёмка» table has **17** rows. | Implement and run all 17. No checks are invented to reach 20. |
| DV-2 | The prompt and skill assume ticketing: venues, events, tickets, QR codes, door scanners, gates, mass event cancellation. | The domain is an online school (courses, cohorts, enrollments). There are no tickets, QR codes, scanners or event cancellation. | Drop QR, scan, scanner role, venue, event and mass cancellation tests. Map the skill's sections: *ticket transfer* → cohort transfer; *mass cancellation* → manager exclusion and student cancel races; *QR forgery* → certificate public link guessing. The threat model replaces "malicious door scanner" with "malicious mentor" (another mentor's work). |
| DV-3 | The prompt and skill mention a virtual queue (1,000 joiners, admission tokens). | Not in the assignment. The waitlist is a different thing and is covered. | Virtual queue dropped completely, with no code, env or tests. The waitlist gets the FIFO, fairness and anti-jumping tests (rejoin and multiple tabs don't improve position). |
| DV-4 | CLAUDE.md and the skill say the payment stub enforces 20 rps with `429`. | The assignment's stub has no rate limit. | No 429 in the stub. The api's paystub client still handles `429` and `Retry-After` generically (retry with backoff), because it is cheap and harmless. |
| DV-5 | The prompt lists "keyboard access, locales" among non-functional requirements. | The assignment names none. Its only UI NFRs are 375 px, live updates, server-clock countdown, field-level errors, URL state and speed. | Not added as matrix rows. Basic semantics come for free (native buttons and labels, focus visible). UI is single-locale English (see AS-32). |
| DV-6 | CLAUDE.md's repo layout lists only `apps/api`, `apps/worker`, `apps/web`, `packages/shared`. | A Prisma schema, migrations, seed and transactional data-access functions must be shared by api and worker, and `packages/shared` must stay IO-free. The payment stub needs its own service. | Add `packages/db` (Prisma schema, SQL migrations, seed, repo functions, test-clock store) and `apps/paystub`. Both are additions, nothing required is removed. |
| DV-7 | CLAUDE.md says double-entry bookkeeping. | The assignment says payments and refunds are immutable and the enrollment balance equals the sum of its operations. | Both apply. `money_operations` is append-only, and each operation writes balanced `ledger_entries` (debits = credits, deferred constraint trigger). `enrollments.balance_minor` is a cache equal to the sum of the enrollment's ledger account, checked by `assertInvariants()`. |
| DV-8 | CLAUDE.md lists `infra/{nginx,db,redis}`. | The mail inbox is a stock image (Mailpit) and needs no config folder. | `infra/nginx`, `infra/db` (init SQL: second database for paystub, `pg_trgm`), `infra/redis` (`redis.conf` with `maxmemory-policy noeviction` for BullMQ, no persistence because Redis is disposable). No `infra/mail`. |
| DV-9 | The skill says "most tests run against the real Nest app on an ephemeral port". | Tests that move the shared clock across processes (worker child processes, cross-stack, e2e) cannot share one stack with each other while running at the same time. | In-process integration and adversarial tests inject a per-test `Clock` and run fully parallel. Cross-process suites get parallelism by sharding across CI runners, one isolated stack per runner. Inside a stack only the clock-moving specs run one at a time, and everything else runs in parallel (§8.2). |
| DV-10 | CLAUDE.md Security baseline cites acceptance scenarios with "1,000 queue joiners, 150 promo applications". | The assignment's numbers are 200 concurrent holds, 50 promo payments, 10× duplicate notification. | The limiter's no-collateral test uses the assignment's numbers. |
| DV-11 | CLAUDE.md: "Redis holds only disposable state". | The assignment requires that failed jobs stay visible to the manager, but BullMQ keeps failed jobs in Redis. | Final failures are also written to Postgres `job_failures`, the manager UI reads from there, and retry re-enqueues from the Postgres record. Redis stays disposable. |
| DV-12 | CLAUDE.md asks for about 10–12 commits, and the Phase 0 prompt suggests 12 blocks. | The user asked for 8 commits with related blocks merged. | 8 commits (§8.1): shared rules merged into the scaffold, seed into the db block, payments into enrollments, worker into homework/certificates/realtime. Each commit is still a complete, green block. |
| DV-13 | CLAUDE.md lists CI jobs in a sequence. | The user asked for CI to run everything that can run in parallel, including e2e. | Parallel job graph with sharding (§8.2). E2E, acceptance and perf depend only on the image build job, and a `ci-ok` aggregator is the single required check. |
| DV-14 | CLAUDE.md and the Phase 0 prompt say "Never push". | The user later instructed: push right after every commit, watch CI, fix and re-push until green. | Push after each commit to `origin/main`. A red pipeline is fixed with follow-up commits, history is never force-pushed. Fix commits do not count against the 8 blocks. |
| DV-15 | The plan's tree lists `packages/shared` and `packages/db`. | The signed payment protocol is used by api, worker and stub, and the job publisher by api and worker; neither belongs in the IO-free shared package. | Added `packages/gateway` (signatures, client, secret box) and `packages/queue` (BullMQ publisher). The transactional business rules live in `packages/db/src/repo`. |

---

## 3. Assumptions (all go to README → "Decisions")

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
- AS-36 **Jobs and Redis loss.** Every job has a deterministic `jobId` and its effect is a guarded db state transition, which makes it idempotent. The api enqueues on commit, and the worker sweeper re-enqueues everything due or pending from Postgres (holds, offers, notifications, refunds, reminders, certificates, emails). The sweeper is a plain interval guarded by `pg_try_advisory_lock`, not a BullMQ repeatable, so `FLUSHALL` can't remove it.
- AS-37 **Realtime.** Socket.IO with `transports: ['websocket']`, so nginx needs no sticky sessions. Rooms: `catalog` (public, seat counts only), `user:{id}`, `mentor:{id}`, `cohort:{id}:staff` (manager of that school or the cohort's mentor). The worker emits through `@socket.io/redis-emitter`. Realtime is best-effort and the UI also refetches on reconnect.
- AS-38 **Seed scale.** `SEED_SCALE` (default `1` = full numbers) multiplies the counts. CI unit and integration jobs use `0.01`, and the e2e/perf job uses `1`. The seed is bulk SQL (`generate_series` + `COPY`) and idempotent (a `seed_runs` marker). All seeded users share one precomputed argon2 hash of `SEED_DEMO_PASSWORD`, a published demo credential (not a secret, default `demo-password-2026`).
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
- AS-50 **Seed shape.** Bulk cohorts have 6 weekly lessons (so 100,000 certificates fit within 1,000,000 submissions); the cohorts with lessons around a DST change have 12. The full seed takes about 4 minutes. The seed disables row guards only inside its own transaction, and the invariant checks verify the result.
- AS-51 **Registration is silent about taken addresses.** `POST /auth/register` answers 202 `{status: "accepted"}` whether or not the address exists; the client then signs in. Staff creation by an administrator does report `EMAIL_TAKEN`.
- AS-52 **Login limiter keys** are per client address and per (account, client address). There is no account-wide lockout, so nobody can lock another person out.
- AS-53 **Enrollment closes when the cohort starts.** The catalog lists cohorts whose first lesson is in the future. A lesson that has started cannot be moved, a lesson can only be moved to a future time, and a new cohort's first lesson must be in the future.
- AS-54 **Staff changes.** A mentor with unfinished cohorts cannot be disabled or turned into a manager until the cohorts are reassigned. Administrators are not managed through the API.
- AS-55 **Sessions.** A disabled account stops working at once (the account is read on every request). Logout revokes the refresh family; an already issued access token ends with its 15-minute lifetime, and the cookie is cleared.
- AS-56 **Writers settle the cohort first.** Every transaction that changes a cohort locks its row, expires overdue holds and offers, and offers free seats to waiters before doing its own work. A payment that arrives at or after the expiry instant is therefore always «late», whether or not the worker has run.
- AS-57 **Offer length near the start.** An offer lasts 24 hours, but never past the cohort start.
- AS-58 **A hold with a rejected promo code stands** at full price, and the response says why the code was not applied. A code cannot be applied to a transfer surcharge.
- AS-59 **One pending transfer per enrollment.** Asking again for the same target returns the pending surcharge hold. Cancelling the old enrollment cancels it. A surcharge paid after the old enrollment ended is returned.
- AS-60 **Transfer options** need the same course and currency and a target that has not started.
- AS-61 **Notification identity** is (school, event id); the first content wins. A payment is also unique by (school, provider payment id). A notification signed by one school cannot touch another school's enrollment.
- AS-62 **The payment stub** accepts refunds by refund id (idempotency key) and order id; it signs every delivery at send time.

---

## 4. Architecture

### 4.1 Stack

| Part | Choice | Source |
|---|---|---|
| DB | PostgreSQL 16 + Prisma (schema, migrations, simple CRUD) + raw SQL via `$queryRaw` tagged templates (locks, constraints, reports) | assignment |
| Queue / adapter | Redis 7, BullMQ, `@socket.io/redis-adapter`, `@socket.io/redis-emitter` | assignment |
| API | NestJS 10, `@nestjs/swagger`, `nestjs-zod`, `@nestjs/websockets` + Socket.IO, helmet, argon2, jose | assignment + defaults |
| Worker | NestJS application context + BullMQ processors, nodemailer | assignment |
| Web | Next.js 15 App Router, React 19, TanStack Query 5, React Hook Form + zod resolver, Tailwind 4, orval-generated client | assignment |
| Shared | zod, luxon (pure) | assignment |
| Payment stub | Node 22 `node:http` + `pg`, functional, server-rendered HTML | default (assignment silent on tech) |
| Mail | Mailpit (SMTP 1025, UI/API 8025) | default |
| Proxy | nginx 1.27 | assignment |
| Tests | Vitest + `unplugin-swc`, supertest, fast-check, socket.io-client, Playwright | assignment + defaults |
| Lint | ESLint flat config, `typescript-eslint` strict, `eslint-plugin-boundaries` for FSD, Steiger | CLAUDE.md |
| Tooling | pnpm workspaces, TypeScript strict, Docker Compose | defaults |

### 4.2 Folder tree

```
.
├── ASSIGNMENT.md / CLAUDE.md / plan.md / README.md
├── .env.example                      every variable, commented, safe placeholders
├── docker-compose.yml                full stack
├── docker-compose.test.yml           overrides: test clock on, chaos toggle, loose limits
├── .github/workflows/ci.yml          install, typecheck, lint, client drift, unit, integration, build, e2e
├── infra/
│   ├── nginx/nginx.conf              upstream api-1/api-2, /api, /docs, /socket.io (ws), /paystub, /, real IP
│   ├── db/init.sql                   paystub database, pg_trgm/btree_gist extensions
│   └── redis/redis.conf              noeviction, no persistence (disposable)
├── packages/
│   ├── shared/src/
│   │   ├── schemas/                  zod input/output schemas (single source for DTOs and forms)
│   │   ├── errors/                   ApiError schema + stable error codes
│   │   ├── money/                    minor units, currency table, discount math
│   │   ├── pricing/                  promo application rules
│   │   ├── schedule/                 recurrence → lessons in cohort tz, DST handling, display in user tz
│   │   ├── homework/                 deadline calc, late flag
│   │   ├── refund/                   refund percent and amount
│   │   ├── certificate/              eligibility
│   │   ├── status/                   enrollment + submission transition maps (who, from, to)
│   │   ├── jobs/                     queue names, job payload schemas, jobId builders
│   │   ├── realtime/                 room names, event payload schemas
│   │   ├── clock/                    Clock type + fixed/offset implementations (pure)
│   │   └── result/                   Result<T,E>
│   └── db/
│       ├── prisma/schema.prisma      models
│       ├── prisma/migrations/        Prisma + hand-written SQL (triggers, CHECKs, partial/GIN indexes)
│       ├── src/client.ts             createDb(url) factory
│       ├── src/repo/<area>/          transactional data-access functions (raw SQL with locks) used by api and worker
│       ├── src/invariants/           assertInvariants(db) — reused by every test suite
│       ├── src/clock-store.ts        test_clock offset reader
│       └── seed/                     bulk SQL seed, scale factor, demo accounts
├── apps/
│   ├── api/src/
│   │   ├── config/env.ts
│   │   ├── main.ts, app.module.ts
│   │   ├── common/                   guards (auth, roles, school scope, csrf), zod pipe, error filter, rate limiter, real-ip
│   │   ├── infra/                    db, redis, queue producers, clock, paystub client
│   │   └── modules/
│   │       ├── auth/                 login, register, refresh rotation, logout
│   │       ├── staff/                admin: staff and roles
│   │       ├── gateway/              admin: payment gateway config
│   │       ├── catalog/              public search
│   │       ├── courses/ cohorts/ lessons/   manager CRUD, schedule, reschedule
│   │       ├── enrollments/          hold, checkout, cancel, refund preview, transfer, exclude
│   │       ├── waitlist/             join, leave, manager view
│   │       ├── promos/               manager CRUD, apply
│   │       ├── payments/             webhook intake (HMAC), manager payments/refunds views
│   │       ├── homework/             student submissions, files
│   │       ├── mentor/               queue, claim, review, students
│   │       ├── certificates/         student download, public verify
│   │       ├── cabinet/              student dashboard aggregate
│   │       ├── reports/              manager report (raw SQL)
│   │       ├── jobs/                 manager failed jobs + retry
│   │       ├── realtime/             Socket.IO gateway, room authz
│   │       └── test-control/         clock endpoint (only when TEST_CLOCK_ENABLED)
│   │   test/attacker/                client, burst, socket, chaos, stubs, clock helpers
│   │   test/adv/                     adversarial real-server suites
│   ├── worker/src/
│   │   ├── config/env.ts, main.ts, worker.module.ts
│   │   ├── processors/<queue>/       one folder per BullMQ queue, thin processor → packages/db repo fn
│   │   ├── sweeper/                  Postgres → queue reconciler (advisory-lock guarded)
│   │   ├── failures/                 final-failure → job_failures
│   │   ├── mail/                     SMTP transport + templates
│   │   └── realtime/                 redis-emitter
│   │   test/adv/                     kill -9, FLUSHALL, multi-worker suites (spawn real processes)
│   ├── paystub/src/                  sessions, pay page, refunds, webhook delivery + retry, chaos, control API
│   └── web/
│       ├── app/                      Next route files only (thin re-exports from src/pages)
│       ├── pages/README.md           keeps Next from using src/pages as Pages Router
│       ├── e2e/                      Playwright specs
│       └── src/
│           ├── app/                  providers (QueryClient, socket), global styles
│           ├── pages/                catalog, course, checkout, cabinet, homework, mentor/*, manager/*, admin/*, verify, auth
│           ├── widgets/              cohort-list, schedule-table, review-queue, cohort-roster, report-panels, jobs-table
│           ├── features/             hold-seat, hold-countdown, apply-promo, join-waitlist, cancel-enrollment, transfer, submit-homework, review-submission, reschedule-lesson, manage-staff, ...
│           ├── entities/             course, cohort, enrollment, lesson, submission, certificate, user
│           └── shared/               api (generated + fetcher), ui kit, lib (url-state, form errors, server-time), config/env.ts
├── tests/
│   ├── cross-stack/                  through nginx, 2 api, worker (multi-copy, IP, realtime, chaos)
│   ├── acceptance/                   A-3…A-15 specs + runner
│   └── perf/                         latency budgets on full seed
├── scripts/                          gen:openapi, gen:client, acceptance/*.sh, check-readme*.ts
└── docs/                             SECURITY-TESTS.md, BUGS_FOUND.md, ACCEPTANCE.md
```

### 4.3 Data flow

```
 Browser ──HTTP/WS──▶ nginx :8080
                        ├─ /            → web (Next SSR; server-side fetch → nginx → api)
                        ├─ /api, /docs  → api-1 | api-2 (round robin)
                        ├─ /socket.io   → api-1 | api-2 (websocket only)
                        └─ /paystub/    → paystub (pay page, admin list)

 api-1, api-2 ──SQL──▶ Postgres (source of truth: seats, journal, money, jobs-to-do)
              ──▶ Redis: BullMQ producers (enqueue after commit), Socket.IO redis-adapter, login rate-limit counters
              ──HTTP signed──▶ paystub (create session)
 paystub ──HMAC webhook──▶ nginx /api/payments/webhook   (chaos: directly to api-1 AND api-2 at once)
 api webhook ──▶ INSERT payment_notifications ON CONFLICT DO NOTHING → 200 → enqueue `payment-notifications`
 worker ×N ──BullMQ──▶ processors → packages/db repo fns (guarded transitions in one tx)
           ──HTTP signed──▶ paystub /refunds (Idempotency-Key)
           ──SMTP──▶ mailpit
           ──redis-emitter──▶ Socket.IO rooms (seat freed, queue changed, roster changed)
 worker sweeper (every SWEEP_INTERVAL_MS, advisory lock) ──SQL──▶ due holds/offers/notifications/refunds/reminders/certs/emails
                                                         ──▶ re-enqueue with deterministic jobId
```

Realtime events: `seats.changed {cohortId, free}` → `catalog` room. `queue.changed {mentorId}` → `mentor:{id}`. `roster.changed {cohortId}` → `cohort:{id}:staff`. `enrollment.changed {id, status, holdExpiresAt, serverNow}` → `user:{id}`. They are emitted after commit by the api (adapter) or by the worker (emitter).

### 4.4 Core DB design (summary; full list goes to README)

- `cohorts(capacity, seats_taken)` with `CHECK (0 <= seats_taken AND seats_taken <= capacity)`. Both columns are maintained **only** by an `AFTER INSERT` trigger on `seat_journal(cohort_id, seats_delta, capacity_delta, enrollment_id, actor_id, reason, at)`. The journal is append-only (UPDATE/DELETE trigger raises). So counter = journal sum structurally, and `assertInvariants` re-checks it.
- `enrollments`: status CHECK; partial unique `(student_id, cohort_id) WHERE status IN ('held','offered','paid','completed')`; `hold_expires_at`; `price_minor`, `currency`; `promo_id`; `transfer_from_id`; `balance_minor`.
- `money_operations` (append-only; kinds `payment`, `refund`, `transfer_out`, `transfer_in`). Unique `provider_payment_id`, unique `refund_request_id`. `ledger_entries` balanced per `operation_id` (deferred constraint trigger). The enrollment balance trigger updates `balance_minor`. `CHECK balance_minor >= 0`.
- `refund_requests` unique `enrollment_id`, `CHECK amount_minor > 0`, plus a trigger that checks `amount ≤ balance` at insert.
- `promo_codes(max_uses, used_count, reserved_count)` with `CHECK used_count + reserved_count <= max_uses`.
- `waitlist_entries` with partial unique `(student_id, cohort_id) WHERE status IN ('waiting','offered')` and index `(cohort_id, joined_at, id) WHERE status = 'waiting'`.
- `submissions`: `CHECK (status = 'in_review') = (reviewer_id IS NOT NULL)`, index `(cohort_id, submitted_at) WHERE status='submitted'`.
- `certificates` unique `(course_id, number)` and unique `(enrollment_id)`, `verify_token_hash` unique.
- `payment_notifications` unique `(provider_event_id)`. Also `scheduled_notifications`, `email_outbox` unique `dedupe_key`, `job_failures`, `test_clock`.
- Search: `pg_trgm` GIN on `courses.title`, `users.full_name`, `users.email`. Btree on `cohorts(start_date)`, `cohorts(price_minor)`, `courses(direction)`.

Lock order (deadlock-free): cohort rows in ascending id → enrollment → promo → mentor.

---

## 5. Env table

S = sensitive (required, no default). Apps: A=api, W=worker, Wb=web, P=paystub, D=packages/db seed/migrate, C=compose.

| Name | Purpose | S | Default | Apps |
|---|---|---|---|---|
| `NODE_ENV` | runtime mode | no | `production` | A W Wb P |
| `LOG_LEVEL` | pino level | no | `info` | A W P |
| `HTTP_PORT` | nginx public port | no | `8080` | C |
| `POSTGRES_USER` | db user | no | `school` | C |
| `POSTGRES_PASSWORD` | db password | **yes** | — | C |
| `POSTGRES_DB` | main db name | no | `school` | C |
| `DATABASE_URL` | main db DSN | **yes** | — | A W D |
| `REDIS_URL` | Redis DSN | no | `redis://redis:6379` | A W |
| `API_PORT` | api listen port | no | `3000` | A |
| `INSTANCE_ID` | api copy name, sent as `X-Instance` | no | `api` | A |
| `PUBLIC_BASE_URL` | public origin (callbacks, return URLs, certificate links) | no | `http://localhost:8080` | A W |
| `CORS_ORIGINS` | comma-separated allowlist (also CSRF Origin check) | no | `http://localhost:8080` | A |
| `TRUSTED_PROXY_CIDRS` | peers allowed to set `X-Real-IP` | no | `172.16.0.0/12,10.0.0.0/8` | A |
| `JWT_ACCESS_SECRET` | access token HMAC key (≥ 32 bytes) | **yes** | — | A |
| `JWT_ACCESS_TTL_SEC` | access TTL | no | `900` | A |
| `REFRESH_TTL_SEC` | refresh TTL | no | `2592000` | A |
| `COOKIE_SECURE` | Secure flag on cookies | no | `false` | A |
| `BODY_LIMIT_JSON_BYTES` | JSON body limit | no | `102400` | A |
| `UPLOAD_MAX_BYTES` | homework file limit | no | `10485760` | A |
| `GATEWAY_ENCRYPTION_KEY` | AES-256-GCM key for stored gateway keys (base64, 32 bytes) | **yes** | — | A W D |
| `WEBHOOK_MAX_SKEW_SEC` | signature freshness | no | `300` | A |
| `HOLD_TTL_SEC` | hold length (assignment: 15 min) | no | `900` | A W |
| `OFFER_TTL_SEC` | waitlist offer length (assignment: 24 h) | no | `86400` | A W |
| `MENTOR_REVIEW_LIMIT` | max in review per mentor (assignment: 5) | no | `5` | A |
| `RATE_LIMIT_ENABLED` | login/register limiter on | no | `true` | A |
| `RATE_LIMIT_LOGIN_IP_MAX` / `_WINDOW_SEC` | per-IP login attempts | no | `20` / `60` | A |
| `RATE_LIMIT_LOGIN_ACCOUNT_MAX` / `_WINDOW_SEC` | per-account login attempts | no | `10` / `300` | A |
| `RATE_LIMIT_REGISTER_IP_MAX` / `_WINDOW_SEC` | per-IP registrations | no | `10` / `3600` | A |
| `RATE_LIMIT_FAIL_MODE` | `open` or `closed` when Redis is down | no | `open` | A |
| `TEST_CLOCK_ENABLED` | enables shared test clock and control route | no | `false` | A W |
| `TEST_CONTROL_TOKEN` | token for test-control routes (required iff enabled) | **yes** (when enabled) | — | A P |
| `WORKER_CONCURRENCY` | per-queue concurrency | no | `8` | W |
| `SWEEP_INTERVAL_MS` | reconciler period | no | `2000` | W |
| `JOB_ATTEMPTS` / `JOB_BACKOFF_MS` | BullMQ retries | no | `8` / `2000` | A W |
| `PAYSTUB_HTTP_TIMEOUT_MS` | api/worker → stub timeout | no | `5000` | A W |
| `SMTP_HOST` / `SMTP_PORT` | mail server | no | `mailpit` / `1025` | W |
| `MAIL_FROM` | sender | no | `school@example.test` | W |
| `MAILPIT_API_URL` | tests read emails | no | `http://localhost:8025` | tests |
| `API_INTERNAL_URL` | web server-side fetch base | no | `http://nginx` | Wb |
| `NEXT_PUBLIC_API_BASE_URL` | browser API base | no | `/api` | Wb |
| `NEXT_PUBLIC_SOCKET_PATH` | browser socket path | no | `/socket.io` | Wb |
| `PAYSTUB_PORT` | stub port | no | `4000` | P |
| `PAYSTUB_DATABASE_URL` | stub db DSN | **yes** | — | P |
| `PAYSTUB_MERCHANT_KEY` | HMAC key shared with school gateway config | **yes** | — | P D |
| `PAYSTUB_PUBLIC_URL` | pay page URL base for redirects | no | `http://localhost:8080/paystub` | P D |
| `PAYSTUB_CHAOS_MODE` | chaos switch (assignment) | no | `false` | P |
| `PAYSTUB_CHAOS_API_TARGETS` | direct api copies for double delivery | no | `http://api-1:3000,http://api-2:3000` | P |
| `PAYSTUB_CHAOS_LATE_PROBABILITY` | share of payments delivered late | no | `0.2` | P |
| `PAYSTUB_CHAOS_LATE_DELAY_SEC` | late delay (assignment: 20 min) | no | `1200` | P |
| `PAYSTUB_CHAOS_EARLY_REFUND_PROBABILITY` | share of refund webhooks sent before response | no | `0.5` | P |
| `PAYSTUB_CHAOS_REFUND_FAIL_EVERY` | every Nth refund → 500/timeout (assignment: 5) | no | `5` | P |
| `PAYSTUB_RETRY_MAX` / `PAYSTUB_RETRY_BASE_MS` | webhook redelivery | no | `10` / `1000` | P |
| `SEED_ON_START` | run seed in the migrate service | no | `true` | D |
| `SEED_SCALE` | seed size multiplier | no | `1` | D |
| `SEED_DEMO_PASSWORD` | published demo password for seeded accounts (not a secret) | no | `demo-password-2026` | D |

**Test/load profile** (`.env.test`, generated from `.env.example` by `scripts/env-test.sh`, used by CI and the acceptance runner): `TEST_CLOCK_ENABLED=true`, `TEST_CONTROL_TOKEN=<random per run>`, `SWEEP_INTERVAL_MS=250`, `JOB_BACKOFF_MS=100`, `RATE_LIMIT_LOGIN_IP_MAX=100000`, `RATE_LIMIT_REGISTER_IP_MAX=100000` (the scenarios register hundreds of students from one IP), `SEED_SCALE=0.01` for integration and `1` for perf/acceptance. **Limiter profile** (`.env.limiter`, used by limiter adv tests): `RATE_LIMIT_LOGIN_IP_MAX=5`, `_WINDOW_SEC=60`, `RATE_LIMIT_LOGIN_ACCOUNT_MAX=3`. The no-collateral test runs A-3/A-6/INV-7a with the limiter profile **on** and must pass.

---

## 6. Threat model

**Assets:** seats (capacity and fairness), money (payments, refunds, balances), promo uses, waitlist positions, certificates (number integrity, authenticity of the verify link), homework (privacy, integrity, reviewer exclusivity), accounts and sessions, gateway keys, failed-job retry power.

**Attackers:** T1 anonymous bot. T2 scalper / seat hoarder. T3 logged-in student going after other students' data. T4 malicious mentor (other mentors' work, other schools). T5 manager of school A going after school B. T6 forged or replayed payment callback holder (incl. someone who knows the gateway key). T7 certificate forger / link guesser. T8 infrastructure failure (worker kill, Redis loss, stub chaos).

| # | Abuse case | Attacker | Defense | Test |
|---|---|---|---|---|
| TM-1 | Credential stuffing on login from one IP | T1 | per-IP + per-account limiter, generic error, argon2 | adv: `limiter.adv.spec.ts` flood |
| TM-2 | Limiter bypass with spoofed `X-Forwarded-For` / `X-Real-IP`, or lock out a victim IP | T1 | header trusted only from `TRUSTED_PROXY_CIDRS`; nginx overwrites | adv: `limiter.adv.spec.ts` spoofing; x: `limiter.x.spec.ts` |
| TM-3 | Parallel login attempts to beat the counter across both copies | T1 | Redis Lua atomic counter, shared | adv: `limiter.adv.spec.ts` shared limit |
| TM-4 | User enumeration via login/register/timing | T1 | identical errors, dummy argon2 verify for unknown emails | adv: `auth.adv.spec.ts` |
| TM-5 | Token tampering, `alg:none`, expired access, refresh reuse | T1, T3 | jose verify with fixed alg; rotation + family revoke | adv: `tokens.adv.spec.ts` |
| TM-6 | CSRF on mutating routes via cookie auth | T1 | Origin allowlist + SameSite | adv: `csrf.adv.spec.ts` |
| TM-7 | Unprotected route or wrong-role access | T3–T5 | global auth guard + role metadata, default deny | adv: `route-sweep.adv.spec.ts` (all routes × anon/student/mentor/manager/admin/other-school) |
| TM-8 | IDOR: other student's enrollment, cancel, refund preview, transfer, submission, file, certificate | T3 | ownership in the SQL `WHERE`, 404 on miss | adv: `idor.adv.spec.ts` |
| TM-9 | Mentor reads or reviews another mentor's work | T4 | mentor scope in claim/review queries | adv: `idor.adv.spec.ts` |
| TM-10 | Manager touches another school's cohorts, students, promos, jobs, reports | T5 | `school_id` scope in every query and the socket room check | adv: `idor.adv.spec.ts`, `route-sweep.adv.spec.ts` |
| TM-11 | Joining a private Socket.IO room (`user:X`, `cohort:Y:staff`, `mentor:Z`) or connecting unauthenticated | T1, T3–T5 | handshake auth + per-join authz | adv: `realtime.adv.spec.ts` |
| TM-12 | Mass assignment: `status`, `price_minor`, `balance`, `role`, `schoolId`, `studentId`, `reviewerId`, `isLate` in bodies | T3–T5 | zod `.strict()` schemas → 400 `VALIDATION_FAILED` | adv: `mass-assignment.adv.spec.ts` |
| TM-13 | Malformed input: float minor units, negative capacity/price, bad tz, bad dates, `__proto__`, SQL injection in search, oversized body (413), wrong content type (415), malformed JSON | T1–T5 | zod at the boundary, parameterized SQL, body limits | adv: `input.adv.spec.ts` (table per endpoint group, asserts ApiError shape, never 500) |
| TM-14 | Seat hoarding with many holds | T2 | one active enrollment per student per cohort; 15 min TTL; waitlist priority | it: `holds.it.spec.ts`; adv: `last-seats.race.adv.spec.ts` |
| TM-15 | Race for the last seats | T2 | conditional update under cohort row lock + CHECK | adv: `last-seats.race.adv.spec.ts`; x: A-3 |
| TM-16 | Waitlist jumping (rejoin, multi-tab, holding while waiting) | T2 | partial unique + FIFO index + AS-7/AS-9 | adv: `waitlist.race.adv.spec.ts` |
| TM-17 | Promo over-use with parallel applies; expired, other-school, other-currency or stacked promo | T2 | reservation counter CHECK under row lock; validity checks | adv: `promo.race.adv.spec.ts`, `promo-abuse.adv.spec.ts` |
| TM-18 | Forged webhook (bad signature, wrong school key, stale timestamp, altered amount) | T6 | HMAC-SHA256 constant-time, skew window, amount checked against fixed price | adv: `webhook.adv.spec.ts` |
| TM-19 | Replayed or duplicated webhook ×10 across both copies | T6, T8 | unique `provider_event_id`, unique `provider_payment_id`, guarded transition | adv: `duplicate-webhook.race.adv.spec.ts`; x: A-8 |
| TM-20 | Gateway key used as an API credential | T6 | key only accepted by the webhook HMAC verifier | adv: `webhook.adv.spec.ts` |
| TM-21 | Payment at the expiry instant: double effect or lost money | T8 | same lock order in expiry and payment paths; late-payment branch | adv: `expiry-vs-payment.race.adv.spec.ts`; x: A-4 |
| TM-22 | Double refund: cancel + exclude, repeated cancel, stub 500/timeout + early webhook | T3, T5, T8 | unique refund request per enrollment, unique refund op, Idempotency-Key | adv: `double-refund.race.adv.spec.ts`, `refund-chaos.adv.spec.ts` |
| TM-23 | Refund above paid (incl. after transfer credit moves) | T3, T5 | balance trigger + `amount ≤ balance` check | it: `ledger.it.spec.ts`; adv: `double-refund.race.adv.spec.ts` |
| TM-24 | Transfer racing a last-seat hold, or a transfer racing a cancel | T2, T3 | both cohorts locked in id order in one tx | adv: `transfer.race.adv.spec.ts` |
| TM-25 | Transfer to another course, another currency, a started cohort, or from a non-paid enrollment | T3 | domain validation | it: `transfers.it.spec.ts` |
| TM-26 | Two mentors (or two tabs) claim the same work; claiming over 5 | T4 | `SKIP LOCKED` + mentor row lock + CHECK | adv: `mentor-claim.race.adv.spec.ts` |
| TM-27 | Late-flag tampering, submitting while in review, resubmitting accepted work | T3 | server-computed `is_late`, transition map | it: `submissions.it.spec.ts`; adv: `mass-assignment.adv.spec.ts` |
| TM-28 | Malicious file (wrong MIME, polyglot, oversize, path in filename) | T3 | magic-byte sniff, allowlist, size limit, served with `Content-Disposition: attachment` + `nosniff` | adv: `upload.adv.spec.ts` |
| TM-29 | Certificate link guessing / enumeration by number or id | T7 | random token of at least 240 bits, numbers never resolve | adv: `certificate-link.adv.spec.ts` |
| TM-30 | Duplicate or gapped certificate numbers under multi-worker / kill -9 / FLUSHALL | T8 | counter row lock + uniques in one tx | adv: `certificates.adv.spec.ts`; x: A-11 |
| TM-31 | Job lost or doubled on worker kill or FLUSHALL | T8 | Postgres outbox + sweeper + deterministic jobIds + guarded transitions | adv: `worker-kill.adv.spec.ts`, `flushall.adv.spec.ts`, `multi-worker.adv.spec.ts` |
| TM-32 | Manager retries another school's failed job, or retries a job to double its effect | T5 | `school_id` scope; retry reruns the idempotent handler | adv: `failed-jobs.adv.spec.ts` |
| TM-33 | Test-clock route reachable in production | T1 | route not registered unless enabled; token compared in constant time | it: `test-clock.it.spec.ts` |
| TM-34 | Gateway key leakage via API or logs | T5, T6 | write-only field, encrypted at rest, log redaction (pino `redact`) | it: `gateway-config.it.spec.ts`; adv: `log-redaction.adv.spec.ts` |

---

## 7. Test plan

### 7.1 Unit (Vitest, fast-check) — `packages/shared`, web `model/lib`, api `domain/`
- **Schedule:** `Tue/Thu 19:00 Europe/Kyiv ×12` starting 2026-03-24 → every lesson is 19:00 local; in UTC it is 17:00Z up to 2026-03-26 (+02:00) and 16:00Z from 2026-03-31 (+03:00, after the 2026-03-29 switch). Same for Warsaw and New York (2026-03-08, 2026-11-01). Gap and overlap local times. Property: for random rules, local wall time always equals the rule time and the lessons are strictly increasing.
- **Deadline:** lesson on the Saturday before DST → deadline 23:59:59.999 local seven days later. Submit at the deadline instant → on time, +1 ms → late.
- **Refund:** NY cohort: cancel at start−60 s → 100 %, at start → 50 %, start+60 s → 50 %, lesson3−1 ms → 50 %, at lesson3 → 0 %. Property: `0 ≤ refund ≤ netPaid`, monotone non-increasing over time.
- **Certificate:** 79/100 no, 80/100 yes, 0 tasks → no, rounding (10/12 = 83 % yes, 9/12 = 75 % no).
- **Transitions:** exhaustive matrix of (role, from, to) → allowed/denied for enrollments and submissions. This drives the README tables.
- **Money and promo:** percent rounding, fixed amount cannot go negative, currency mismatch, float input rejected by the schema.
- **Web:** countdown from `{holdExpiresAt, serverNow}` with the client clock skewed ±10 min; API error → field error mapping; URL-state codec round-trip for catalog, report and queue filters.

### 7.2 Integration (real Postgres and Redis, in-process Nest via supertest)
- DB constraints suite: every CHECK, unique, append-only trigger and balanced-ledger trigger is violated on purpose and must raise.
- Per module: happy path, every documented error code, side effects in the db, other tenants unaffected.
- OpenAPI: every operation has a request schema (if it has a body), response schemas, and the `ApiError` responses (400/401/403/404/409/413/415/422/429 where relevant). The generated doc snapshot equals the committed `openapi.json`.

### 7.3 Adversarial real-server suite (`apps/api/test/adv`, `apps/worker/test/adv`)
Harness `apps/api/test/attacker/`: `client({ip, auth})` with `localAddress: 127.0.0.N`; `burst(n, fn)` with a start barrier; `socket({auth, apiCopy})`; `twoCopies()` boots two Nest apps on two ports sharing Postgres/Redis; `chaos.killWorker() / restartWorker() / flushRedis()` (worker spawned as a child process, `SIGKILL`); `stubs.paystub` and `stubs.mailpit`; `clock.advance(ms)`; `assertInvariants()` from `packages/db`.

Scenarios fitted to the assignment numbers (each race ×20 iterations, then `assertInvariants()`):
1. **Last seats:** 200 students, cohort with 5 free, `burst(200)` hold split across two copies → exactly 5 `201`, 195 `409 NO_SEATS` with `waitlistAvailable: true`, journal +5. Variant with 1 free seat.
2. **Expiry vs payment:** hold, move the clock to `expires_at`, then `burst` [expire job, webhook ×3] → enrolled XOR (expired + refund request of the full amount). Loop 20 with random interleaving offsets.
3. **Waitlist:** cohort full, 10 waiters, 3 paid students cancel in one burst → offers exactly to waiters 1–3. Clock +24 h + sweep → waiter 1's offer expires, waiter 4 gets exactly one offer. Rejoin and multi-tab don't move positions.
4. **Promo:** promo with 10 uses, 50 held students, `burst(50)` apply → 10 OK, 40 `PROMO_EXHAUSTED`. Then 3 of the 10 expire → reservations released → 3 more can apply. Paid with discount = number of uses.
5. **Transfer:** student in A, target B with 1 seat; `burst` [transfer A→B, hold on B by another student] → student in exactly one cohort, B ≤ capacity, A freed iff moved.
6. **Duplicate webhook:** the same signed event ×10, 5 per copy, in parallel → one payment op, one journal row, enrollment `paid`. Same event id with a different body → ignored and logged, no second op.
7. **Refund chaos:** stub with chaos on, 25 refunds → all land after retries, exactly one refund op each, `Σ refunds ≤ Σ paid` per enrollment. Early webhook before response → still one.
8. **Cancel + exclude race:** `burst` [student cancel, manager exclude] ×20 → one refund request.
9. **Reminders:** Kyiv lesson at 19:00 on 2026-03-31 (DST week). Clock to 24 h−1 s → no email, to 24 h → exactly one. Reschedule 30 min before the 1 h reminder → the old 1 h reminder never arrives, the new one arrives once at the new time.
10. **Certificates:** 3 cohorts of one course end. Two worker processes are started, one is `kill -9`'d mid-batch, then FLUSHALL, then restart → numbers 1…N consecutive, at most one per enrollment, only for eligible students.
11. **Worker kill during expiry:** 100 expiring holds, kill -9 the worker after the first progress, restart → all expired once, journal −100 exactly.
12. **FLUSHALL:** pending holds, offers, reminders, refunds → FLUSHALL → all fire once (sweeper).
13. **Failed jobs:** the stub refund endpoint is forced to fail permanently → after attempts the job is visible to that school's manager only. Fix the stub → retry → refund lands once. Survives FLUSHALL.
14. **Permissions:** route sweep from the Nest route table. IDOR matrix. Tokens. Mass assignment. Realtime (unauthenticated rejected, private-room joins rejected, cross-copy event in < 1 s).
15. **Limiter (limiter profile):** flood from 127.0.0.2 → `429` + `Retry-After` while 127.0.0.3/4 get 2xx; spoofed headers ignored; shared across two copies, `burst(50)` never above the limit; Redis stopped → fail-open as documented and holds/checkout still work; no-collateral: scenarios 1, 4, 6 pass with the limiter on.
16. **Input:** table-driven per endpoint group, as in TM-13.

### 7.4 Cross-stack and acceptance (`tests/cross-stack`, `tests/acceptance`)
Run against `docker compose -f docker-compose.yml -f docker-compose.test.yml up`: through nginx, two api copies, real worker containers (`docker kill -s KILL`), `redis-cli FLUSHALL`, chaos stack restart for A-8. Each A-check is a spec, and the runner writes `docs/ACCEPTANCE.md`.

### 7.5 E2E (Playwright, full stack)
The five assignment journeys (D-E2E-1…5), `mobile-375.e2e.ts` (375×812 viewport, student cabinet), `forms.e2e.ts` (field errors), `a16-url-state.e2e.ts` (reload and Back restore filters). Emails are read from the Mailpit API, and the clock is moved through the test-control route.

### 7.6 Performance
`tests/perf/budgets.perf.spec.ts` on the full seed through nginx, p95 of 50 warm runs: catalog search (title trigram + filters) < 200 ms, mentor queue < 200 ms, student search name/email < 300 ms, 12-month report < 1 s. `EXPLAIN (ANALYZE)` plans are saved to `docs/perf/` for README.

### 7.7 Mutation check (`docs/SECURITY-TESTS.md`)
Each done by a script that applies a patch, runs the matching tests, expects failure and reverts:
1. limiter disabled → `limiter.adv` fails;
2. auth guard returns true → `route-sweep.adv` fails;
3. `.strict()` removed from the hold DTO → `mass-assignment.adv` fails;
4. `FOR UPDATE` dropped and the `seats_taken <= capacity` CHECK dropped (migration down) → `last-seats.race.adv` fails;
5. unique on `refund_requests.enrollment_id` dropped → `double-refund.race.adv` fails.

---

## 8. Commit plan (8 commits) and CI pipeline

Every commit passes `pnpm typecheck && pnpm lint && pnpm test && pnpm build` locally and in CI before it is made. Each commit also extends `ci.yml` with the jobs for the parts it adds, so CI always covers everything that exists.

### 8.1 Commits

| # | Commit | Contents | Its tests prove |
|---|---|---|---|
| C1 | `feat: workspace scaffold, CI, compose infra and shared domain rules` | pnpm workspace, tsconfig base, ESLint (strict + boundaries), Vitest projects + swc, `.env.example` (all of §5), `docker-compose.yml` (postgres, redis, mailpit), `infra/db`, `infra/redis`, `scripts/env-test.sh`, `.github/workflows/ci.yml` (parallel jobs from §8.2 that apply so far). `packages/shared`: result, errors, clock, zod schemas, money, promo math, schedule + DST, display tz, deadline, refund, certificate eligibility, transition maps, job and realtime contracts | Unit + property suites from §7.1; CI green |
| C2 | `feat(db): schema, migrations, seat journal, ledger, constraints and bulk seed` | `packages/db`: Prisma schema, SQL migrations (triggers, CHECKs, partial and GIN indexes), `createDb`, `assertInvariants`, clock store, bulk seed with `SEED_SCALE`, idempotent marker, last-seat and DST cohorts, demo logins | Constraints suite (every guard violated on purpose and raises), journal and ledger triggers, `seed.it.spec.ts` + `assertInvariants` on seeded data, full-scale seed timing recorded |
| C3 | `feat(api): core platform with auth, roles, staff, catalog, courses, cohorts and schedule` | env, error filter + ApiError, nestjs-zod + Swagger `/docs`, `gen:openapi`, auth (argon2, JWT, refresh rotation), guards, CSRF, helmet, body limits, real-IP + Redis limiter, staff admin, catalog search, course/cohort/lesson CRUD + reschedule, test-control clock, attacker harness | route sweep, tokens, CSRF, input, mass-assignment, limiter adv (flood, spoof, shared, Redis down), openapi it |
| C4 | `feat: enrollments, waitlist, promo, transfers, payment stub and payment flow` | enrollment repo fns (locks), hold, waitlist + allocation, promo reserve/release, capacity change, cancel with refund preview, exclude, transfer (both diff branches), outbox rows. `apps/paystub` (pay page, sessions, refunds, list, HMAC delivery + retries, chaos, control API). Api gateway config (encrypted), checkout, webhook intake, payment/refund processing, late-payment branch | last-seats, waitlist, promo, transfer, cancel+exclude races (two in-process copies), refund preview = actual, webhook forgery/replay/key-scope, duplicate ×10 across copies, expiry-vs-payment, refund chaos, stub delivery retry |
| C5 | `feat: homework, mentor queue, certificates, reports, realtime and worker` | submissions + files, mentor queue/claim/review/students, cabinet, certificate PDF + public verify, reports (raw SQL), failed-jobs API, Socket.IO gateway + redis adapter + room authz. `apps/worker`: processors for every queue (hold-expiry, waitlist-offers, payment-notifications, refunds, reminders, deadline-reminders, certificates, emails), sweeper, job_failures, mailer, redis-emitter | mentor-claim race, IDOR (student/mentor/manager), certificate link, upload, realtime cross-copy < 1 s, reports fixture, worker kill -9, FLUSHALL, multi-worker, certificates, reminders (DST + reschedule), failed-job retry |
| C6 | `feat(web): Next.js app with catalog, checkout, cabinet, mentor and manager areas` | FSD layout + boundary lint + Steiger, orval client generation + drift check, pages from §4.2, socket provider, server-time countdown, URL state, field errors, 375 px layout | web unit tests (countdown, URL codec, error mapping), boundary lint, build |
| C7 | `feat(infra): nginx with two api copies, full compose, acceptance, e2e and perf suites` | nginx.conf, Dockerfiles (api, worker, web, paystub, migrate), full compose + test override, migrate+seed service, cross-stack suite, acceptance runner, Playwright journeys, perf budgets, CI image/e2e/acceptance/perf jobs | everything in §7.4–7.6 against the real stack |
| C8 | `docs: README, security test report and bug log` | README (every required section, transition tables generated from the shared maps, DB indexes and constraints, decisions = §3), `docs/SECURITY-TESTS.md` with mutation results, `docs/BUGS_FOUND.md`, `docs/ACCEPTANCE.md`, readme check scripts in CI | readme checks pass; A-17 |

### 8.2 CI pipeline (parallel)

No job waits for an unrelated job. E2E, acceptance and perf start as soon as the Docker images are built, alongside unit, integration and lint, not after them. Each job restores the pnpm store cache (`actions/setup-node` with `cache: pnpm`, keyed on the lockfile) and runs `pnpm install --frozen-lockfile`.

```
 push ──┬─ typecheck            (pnpm -r --parallel typecheck)
        ├─ lint                 (eslint + FSD boundaries + steiger)
        ├─ client-drift         (gen:openapi → gen:client → git diff --exit-code)
        ├─ unit                 (vitest project "unit", thread pool)
        ├─ integration [1..3]   (vitest --shard, own postgres+redis services per shard)
        ├─ adversarial [1..3]   (vitest --shard, in-process two api copies, own services)
        ├─ worker-chaos         (spawns worker processes, kill -9 / FLUSHALL; own services)
        ├─ build                (pnpm -r build, Turbo-style topological parallelism via pnpm)
        └─ images               (docker buildx bake, all images in parallel, GHA layer cache)
                 ├─ e2e [1..4]          (Playwright --shard, each shard boots its own compose stack from cached images)
                 ├─ acceptance [1..3]   (A-checks split in groups, each group on its own stack)
                 ├─ cross-stack          (nginx / two copies / limiter / realtime specs)
                 └─ perf                 (full seed SEED_SCALE=1, latency budgets)
 all ──▶ ci-ok (aggregator job, needs every job above; the single required status check)
```

Rules that make this parallelism safe:
- **One stack per runner.** Shards never share a database, Redis or test clock, so the clock-moving specs in one shard can't affect another.
- **Inside a stack**, Playwright and the cross-stack suite use two projects: `parallel` (specs that don't move the shared clock: authz, realtime, limiter, catalog, forms, 375 px) with `fullyParallel: true` and several workers, and `clock` (specs that move time) run one at a time. Shards balance both kinds.
- **In-process suites** (unit, integration, adversarial) inject a per-test `Clock` and create their own data, so they run fully parallel within a job (Vitest threads).
- The `integration`, `adversarial`, `e2e` and `acceptance` shard counts are matrix values, so they can be raised later without code changes.
- Locally, `pnpm test` runs the unit, integration and adversarial Vitest projects in one parallel run, and `pnpm test:stack` runs e2e + cross-stack + acceptance against the local compose stack.

---

## 9. Progress checklist

- [x] C1 scaffold + CI + compose infra + shared domain rules
- [x] C2 db schema, journal, ledger, constraints + seed
- [x] C3 api core (auth, roles, staff, catalog, courses, cohorts, schedule, limiter)
- [x] C4 enrollments, waitlist, promo, transfers + paystub + payments/refunds
- [ ] C5 homework, mentor, certificates, reports, realtime + worker
- [ ] C6 web
- [ ] C7 nginx + full compose + acceptance + e2e + perf
- [ ] C8 README + docs
- [ ] Mutation check recorded in `docs/SECURITY-TESTS.md`
- [ ] Acceptance A-1…A-17 results recorded below
- [ ] Clean-checkout verification (`.env.example` → `.env`, typecheck, lint, test, build, adv, compose smoke)

### Acceptance results

| Check | Result | Evidence |
|---|---|---|
| A-1 … A-17 | pending | — |

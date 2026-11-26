CLAUDE.md

# CLAUDE.md — standing rules for this repo

## Priority order (highest wins)

1. `ASSIGNMENT.md` — every requirement, no exceptions.
2. Approved `plan.md`.
3. This file.
4. Your own defaults.

If two levels conflict, follow the higher one and log the conflict in plan.md → "Deviations".

## Stack rule: the assignment decides the stack

Every technology named in this file (postgres, redis, nginx, docker compose, React, Vite, and so on) is a DEFAULT, never a requirement. If the assignment forbids, replaces or omits a technology, do not use it. Drop its block from the commit plan, its folder, its env vars, its compose service and its tests, and note it in plan.md → Deviations. Where a removed component had a job (for example Redis for rate-limit counters), implement that job with what the assignment allows (in-memory store, the db, and so on) behind a small interface. Keep the same security guarantees and keep the same tests, adapted to the new store. Never leave dead config, unused dependencies or empty folders for a removed technology.

## Paradigm

- **Classes only for NestJS constructs**: modules, controllers, providers/services, guards, interceptors, pipes, filters. Keep them thin. They wire dependencies and delegate to pure functions. No business logic in a class body.
- **Everything else is functional**: no `class`, no `this`, no inheritance. Pure functions, immutable data (`readonly`, `as const`, spread instead of mutate), composition over inheritance.
- Side effects live at the edges (db, redis, http, clock, random). Inject them as parameters or via factories `createX(deps) => ({ ... })`. Never import a singleton inside a pure function.
- Expected failures are values (`Result<T, E>`). Throw only for programmer errors and unexpected states.
- Named exports only. No default exports. No barrel files that re-export whole folders, except FSD public APIs. **One exception:** Next.js route files (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `template.tsx`, `default.tsx`) and tool config files that require a default export may use `export default`. Keep those files as thin wrappers that import named exports from `src/pages`. Do not log this as a deviation.
- TypeScript `strict`. No `any`, no `@ts-ignore` without a one-line reason, no non-null `!` assertions. Validate every external input with zod at the boundary and infer types from the schemas.

## Frontend: Feature-Sliced Design (strict)

```
apps/web/src/
  app/        providers, router, global styles, entry
  pages/      route-level composition
  widgets/    large self-contained UI blocks
  features/   user actions that deliver business value
  entities/   business entities (types, api, UI)
  shared/     ui kit, api client, lib, config. No business logic.
```

- A layer may import only from layers below it. Never import sideways between slices on the same layer.
- Each slice has segments by purpose: `ui/`, `model/`, `api/`, `lib/`, `config/`. Import a slice only through its `index.ts` public API, never its internals.
- Enforce this with a linter (`steiger` or `eslint-plugin-boundaries`) and make violations fail lint.
- Components are functions with hooks. UI holds no business rules. Rules live in pure functions in `model/` or `lib/`.

### FSD inside Next.js (App Router)

Next owns the root `app/` folder for routes, and FSD's `app` and `pages` layers both clash with Next's folders. Use this layout:

- Root `apps/web/app/` holds only Next route files (`page.tsx`, `layout.tsx`, route handlers). Each one is a thin re-export or composition of a page from `src/pages`.
- All FSD layers live in `apps/web/src/` (`app`, `pages`, `widgets`, `features`, `entities`, `shared`).
- Add an empty `apps/web/pages/README.md` so Next never treats `src/pages` as a Pages Router.
- Server Components are allowed, but business rules still live in pure functions in `model/` or `lib/`, or in `packages/shared`.
- The API client is generated from OpenAPI into `shared/api`. Never hand-edit generated code, and regenerate it with a script.

## Backend structure (applies to `apps/api` and `apps/worker`)

```
apps/api/src/
  config/env.ts        zod-parsed env, the only reader of process.env
  main.ts, app.module.ts
  modules/<domain>/
    <domain>.module.ts | .controller.ts | .service.ts   (Nest classes, thin)
    domain/            pure business logic, no framework imports
    dto/               zod schemas + inferred types
    repo/              data access functions
    *.spec.ts          tests next to the code
  common/              guards, filters, interceptors, pipes
  infra/               db and redis clients, factories
```

One folder per responsibility. A file has one reason to change and stays under about 200 lines. Business rules in `domain/` must be testable without Nest, db or redis.

## Repo layout

`apps/api`, `apps/worker`, `apps/web`, `packages/shared`, `infra/{nginx,db,redis}`, `docker-compose.yml`, `.env.example`, `docs/`, `plan.md`, `CLAUDE.md`, `ASSIGNMENT.md`.

`packages/shared` holds zod schemas, rule constants and pure calculations (prices, refunds). `api`, `worker` and `web` all import from it, so a rule exists in exactly one place. It contains no framework code and no IO.

Defaults, used ONLY where the assignment is silent: pnpm workspaces, TypeScript strict, PostgreSQL, Redis, nginx, docker compose, Vitest for unit tests, Jest or Vitest with supertest for Nest, React + Vite for web. Log each default you use as an assumption. Where the assignment names a stack (for example Prisma, BullMQ, Next.js, Playwright), use exactly that.

Known integration points (solve them, do not work around them):

- **OpenAPI from zod:** schemas live in `packages/shared` as zod. `@nestjs/swagger` needs DTO classes, which are allowed because they are Nest constructs. Use `nestjs-zod` (or equivalent) so the DTO classes are generated from the shared zod schemas, and the OpenAPI document stays the single source for the generated web client. Error responses use one shared error schema with a stable `code` and are declared on every endpoint. No response type is written by hand.
- **Vitest + NestJS decorators:** Vitest's default transform drops decorator metadata. Use an SWC plugin (`unplugin-swc`) in the Vitest config for api and worker.

## Data and money rules (when the assignment involves them)

- The database is the single source of truth. Redis holds only disposable state. Losing all of Redis must lose no orders, money or queue positions. Prove it with a test.
- Money is stored as integer minor units, never floats. Use double-entry bookkeeping: every movement is a balanced set of ledger entries (debits equal credits), and ledger rows are append-only. Enforce it with DB constraints, and add a test that checks the invariant after every scenario.
- Use raw SQL with explicit locks or constraints (`SELECT ... FOR UPDATE`, unique and exclusion constraints) wherever Prisma alone cannot guarantee correctness, such as overselling, double booking and double refunds. Every state change is idempotent and safe to retry.
- Jobs are idempotent: processing the same job twice, or on two worker copies at once, must have the same effect as once.

## Environment

- `.env.example` lists EVERY variable with a comment and a safe placeholder. It is committed. `.env` is gitignored and copied from the example.
- Each app (`apps/api`, `apps/worker`, `apps/web`) has its own `src/config/env.ts`. For web, server-only variables and `NEXT_PUBLIC_*` variables are validated separately. Each file contains a zod schema, `safeParse(process.env)`, readable error and exit on failure. Defaults for NON-sensitive variables only (ports, timeouts, limits, log level). Secrets (JWT secret, db password, API keys) are required and have no default. Export one typed `Object.freeze`d `env`.
- Nothing else touches `process.env`. docker compose and tests also read from the same `.env`.

## Security baseline

- Passwords: argon2id or bcrypt with sane cost. Tokens: short-lived access plus rotating refresh with reuse detection, if the assignment uses tokens.
- Constant-time comparisons for secrets. Generic auth errors, so no user enumeration.
- Parameterized queries only. Strict body-size and content-type limits. Helmet-style headers. CORS allowlist from env.
- The assignment does NOT require a general per-user API rate limiter. Its only mandated throttles are the payment stub's 20 requests per second (excess gets `429`) and the virtual queue. Any extra throttling you add (login, sensitive endpoints) is optional hardening, and it must obey these rules:
  - Every limit and window is an env variable. A `.env` test/load profile sets them loose enough that the acceptance scenarios never trip them. Those scenarios send hundreds or thousands of requests from one IP: 200 concurrent holds, 150 promo applications, 1,000 queue joiners and mass cancellation.
  - Never throttle the hold, order, payment, queue, scan or realtime flows by IP in a way that blocks those scenarios.
  - Keyed by the real client IP (and by account where relevant), stored in Redis with atomic operations (Lua or INCR+EXPIRE). Throttle state is disposable, so losing Redis only resets counters. `X-Forwarded-For` is honored only from nginx and is spoofing-proof. Document fail-open vs fail-closed when Redis is down.
  - Where it exists, the adversarial limiter tests in the skill apply to it, run with the limiter profile enabled.
- Never log secrets, tokens or passwords.

## Testing philosophy

Tests exist to find bugs. A test that cannot fail is worthless.

- Unit: pure domain functions, with edge cases, boundaries and property-style inputs.
- Integration: Nest app against real postgres and redis (docker compose or testcontainers). No mocking the db or redis in integration tests.
- Adversarial/E2E: real server, real network, real malicious client. Follow `.claude/skills/adversarial-testing/SKILL.md`. Required for auth, rate limiting, routes, input handling and anything sensitive.
- Frontend: test model/lib functions and key feature flows with Vitest. Add a boundary lint for FSD.
- E2E: Playwright against the full docker compose stack (nginx, two `api` copies, worker, web), covering the main user journeys.
- After writing security tests, run a mutation check: disable the protection and confirm the test fails. Restore it.
- No `.skip`, `.only` or flaky sleeps (poll with timeouts instead). Tests are deterministic and parallel-safe.

## CI (required by the assignment: CI on every commit)

- `.github/workflows/ci.yml` is created in the FIRST commit, and every later commit passes it.
- Jobs: install with a frozen lockfile, typecheck, lint (including the FSD boundary lint), regenerate the OpenAPI client and fail on any diff (`git diff --exit-code`), unit tests, integration tests with real postgres and redis as services, build, and an e2e job that runs docker compose plus Playwright once those parts exist.
- Run the same commands locally before each commit.

## Git

- Never push. History reflects stages of work (the assignment says so). Commit only complete blocks (see the plan.md commit plan), about 10–12 commits total. Each commit builds and is green in CI.
- Before every commit: typecheck, lint, test and build are green, and the working tree contains only that block.
- Conventional Commits, for example `feat(api): auth module with refresh rotation`. The body lists what the block contains and what its tests prove.
- Never commit `.env`, secrets or `node_modules`.

## Working rules

- Run it. Never claim something works without executing it and reading the output.
- After the plan is approved, do not ask questions. Decide, log the decision in plan.md "Assumptions", and continue. Stop only for a true blocker.
- Do not stop after a commit. Update the plan.md checklist and continue to the next block until the finish line is met.
- Do not skip, stub or leave TODOs for any assignment requirement. No `console.log`, commented-out code or dead files left behind.
- Keep plan.md current. It is the memory of this job if the context resets.
- The assignment requires decisions on ambiguous points to be written in the README. Log each decision in plan.md "Assumptions" as you make it, and make sure it ends up in the README's decisions section. The README must contain every section the assignment lists, plus the status transition tables (who, from which status), and it must match actual behavior. Log the README language as an assumption.

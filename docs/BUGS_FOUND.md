# Bugs found by tests

| # | Bug | Found by | Fix |
|---|---|---|---|
| 1 | With Redis unreachable, closing the job publisher waited for a connection for ever, so an api copy could not shut down. | `apps/api/test/adv/limiter.adv.spec.ts` (Redis down) | The publisher drops the socket without closing queues when Redis is not ready (`packages/queue/src/publisher.ts`). |
| 2 | Under load, requests failed with 500 because the connection pools of two api copies could exceed the Postgres connection limit. | `apps/api/test/cohorts.it.spec.ts`, webhook suite | `max_connections` raised in compose; pools bounded in tests. |

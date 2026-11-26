#!/usr/bin/env bash
# A-1: `cp .env.example .env && docker compose up --build` brings everything up, with no other
# step. Run from a clean state; it removes this project's containers and volumes first.
set -euo pipefail
cd "$(dirname "$0")/../.."

cp .env.example .env
docker compose down --volumes --remove-orphans
docker compose up --build --detach --wait --wait-timeout "${WAIT_TIMEOUT:-900}"

port=$(sed -n 's/^HTTP_PORT=//p' .env)
for path in / /docs /paystub/ /api/health '/api/catalog/cohorts?pageSize=1'; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${port}${path}")
  echo "GET ${path} -> ${code}"
  [ "$code" = 200 ]
done

# A seeded account can sign in through nginx.
password=$(sed -n 's/^SEED_DEMO_PASSWORD=//p' .env)
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' \
  -d "{\"email\":\"manager@school1.example.test\",\"password\":\"${password}\"}" \
  "http://localhost:${port}/api/auth/login")
echo "demo login -> ${code}"
[ "$code" = 200 ]

# Every login the README lists really signs in.
for email in $(grep -oE '`[a-z0-9]+@[a-z0-9.]+\.example\.test`' README.md | tr -d '`' | sort -u); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' \
    -d "{\"email\":\"${email}\",\"password\":\"${password}\"}" \
    "http://localhost:${port}/api/auth/login")
  echo "${email} -> ${code}"
  [ "$code" = 200 ]
done

for service in postgres redis api-1 api-2 nginx web paystub mailpit; do
  health=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q "$service")")
  echo "${service}: ${health}"
  [ "$health" = healthy ]
done
[ -n "$(docker compose ps --status running -q worker)" ]
echo "worker: running"

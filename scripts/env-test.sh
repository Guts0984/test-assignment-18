#!/usr/bin/env bash
# Writes .env.test from .env.example with the test profile. Usage: scripts/env-test.sh [out]
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-.env.test}"
cp .env.example "$out"

set_var() {
  sed -i "s|^$1=.*|$1=$2|" "$out"
  grep -q "^$1=" "$out" || { echo "unknown variable: $1" >&2; exit 1; }
}

set_var TEST_CLOCK_ENABLED true
set_var TEST_CONTROL_TOKEN "$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
set_var SWEEP_INTERVAL_MS 250
set_var JOB_BACKOFF_MS 100
set_var RATE_LIMIT_LOGIN_IP_MAX 100000
set_var RATE_LIMIT_REGISTER_IP_MAX 100000
set_var SEED_SCALE "${SEED_SCALE:-0.01}"

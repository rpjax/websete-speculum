#!/usr/bin/env bash
# Seed admin config for motor-assertive stack. Runs from GitHub Actions after compose is healthy.
set -euo pipefail

API_BASE="${MOTOR_ASSERT_API_BASE:-http://127.0.0.1:18080}"
ADMIN_KEY="${MOTOR_ASSERT_ADMIN_KEY:-motor-assert-admin-key}"
AUTH="Authorization: Bearer ${ADMIN_KEY}"

echo "Waiting for ${API_BASE}/health ..."
for i in $(seq 1 60); do
  if curl -sf "${API_BASE}/health" >/dev/null; then break; fi
  sleep 2
done
curl -sf "${API_BASE}/health" >/dev/null

echo "Seeding Forwarding / MaxSessions / Hosting / JsBridge ..."
curl -sf -X PUT "${API_BASE}/api/admin/config/Forwarding" \
  -H "${AUTH}" -H "Content-Type: application/json" \
  -d '{"host":"fixture.test","domains":["fixture.test","*.fixture.test"]}'

curl -sf -X PUT "${API_BASE}/api/admin/config/MaxSessions" \
  -H "${AUTH}" -H "Content-Type: application/json" \
  -d '4'

curl -sf -X PUT "${API_BASE}/api/admin/config/Hosting" \
  -H "${AUTH}" -H "Content-Type: application/json" \
  -d '{"profiles":[{"domain":"speculum.test","subdomainMirroringEnabled":false}]}'

curl -sf -X PUT "${API_BASE}/api/admin/config/JsBridge" \
  -H "${AUTH}" -H "Content-Type: application/json" \
  -d '{"enable":true}'

echo "Waiting for /ready ..."
for i in $(seq 1 30); do
  if curl -sf "${API_BASE}/ready" >/dev/null; then
    echo "Seed complete — API ready."
    exit 0
  fi
  sleep 1
done

echo "API did not become ready" >&2
curl -s "${API_BASE}/api/admin/config/status" -H "${AUTH}" || true
exit 1

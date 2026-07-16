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

# Assertive diagnostics profile is also set via SPECULUM_DIAGNOSTICS_PROFILE=Assertive on the API container.
# Ensure BrowserQuery probe + snapshots toggles and full Telemetry sections are on for MotorAssert / MotorPerf.
# Mirrors MotorAssertFixture.AssertiveDiagnosticsConfig so seed and per-test baseline stay in lockstep.
curl -sf -X PUT "${API_BASE}/api/admin/config/Diagnostics" \
  -H "${AUTH}" -H "Content-Type: application/json" \
  -d '{"enabled":true,"profile":"Assertive","domains":{"motor":{"metrics":true,"events":true,"snapshots":true},"sidecar":{"metrics":true,"events":true},"browserQuery":{"probe":true},"persisted":{"snapshots":true}},"telemetry":{"enabled":true,"intervalSeconds":5,"host":{"enabled":true,"procPath":"/host/proc","sampleIntervalMs":1000,"includeLoadAverage":true,"includeSwap":true,"includeDiskIo":true,"includeNetwork":true},"apiProcess":{"enabled":true,"sampleIntervalMs":1000,"includePrivateMemory":true,"includeGc":true,"includeThreadPool":true},"motor":{"enabled":true,"includeSessionIds":true,"includePerSession":true,"includeUrlHost":true},"sidecar":{"enabled":true,"includeFaultedIds":true},"persistence":{"enabled":true,"includeBytes":true},"pipeline":{"enabled":true,"includeBreakerPressure":true}},"probe":{"maxConcurrentProbesPerSession":2,"diagTimeoutMs":10000,"maxProbeResponseBytes":524288}}'

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

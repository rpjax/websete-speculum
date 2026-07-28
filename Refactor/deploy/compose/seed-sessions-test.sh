#!/usr/bin/env bash
# Explicitly enable opt-in Telemetry event facts for SessionsTest (never auto-on).
set -euo pipefail

API_BASE="${SESSIONS_TEST_API_BASE:-http://127.0.0.1:18090}"

echo "Seeding SessionsTest Telemetry events at ${API_BASE}…"

curl -sf -X PUT "${API_BASE}/api/configurations/Telemetry" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "events": {
      "Telemetry.Sessions.Input.Applied": true,
      "Telemetry.Sessions.Input.Rejected": true,
      "Telemetry.Sessions.Resize.Applied": true,
      "Telemetry.Sessions.Resize.Rejected": true
    }
  }' | tee /tmp/sessions-test-seed.json

echo
echo "Seed complete (Telemetry input/resize events explicitly enabled)."

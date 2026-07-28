#!/usr/bin/env bash
# Explicitly enable opt-in Journal types for SessionsTest (never auto-on).
# Telemetry facts are Telemetry-owned — enable via PUT /api/configurations/Telemetry
# (SessionsTestFixture.EnsureTelemetryEnabledAsync) or Telemetry__IsEnabled on first boot.
set -euo pipefail

API_BASE="${SESSIONS_TEST_API_BASE:-http://127.0.0.1:18090}"

echo "Seeding SessionsTest journal enablement at ${API_BASE}…"

curl -sf -X PUT "${API_BASE}/api/configurations/Journal" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "events": {
      "Sessions.InputApplied": true,
      "Sessions.InputRejected": true,
      "Sessions.ResizeApplied": true,
      "Sessions.ResizeRejected": true
    }
  }' | tee /tmp/sessions-test-seed.json

echo
echo "Seed complete (Journal InputApplied/InputRejected/Resize* explicitly enabled)."

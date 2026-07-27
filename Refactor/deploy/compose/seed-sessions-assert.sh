#!/usr/bin/env bash
# Explicitly enable opt-in Journal types for SessionsAssertive (never auto-on).
set -euo pipefail

API_BASE="${SESSIONS_ASSERT_API_BASE:-http://127.0.0.1:18090}"

echo "Seeding Sessions assert journal enablement at ${API_BASE}…"

curl -sf -X PUT "${API_BASE}/api/dev/engine-config" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "journal": {
      "Sessions.InputApplied": true,
      "Sessions.ResizeApplied": true,
      "Sessions.ResizeRejected": true
    }
  }' | tee /tmp/sessions-assert-seed.json

echo
echo "Seed complete (Journal InputApplied/Resize* explicitly enabled)."

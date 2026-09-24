#!/usr/bin/env bash
# Phase 10 gates — real A3/A5 + A2/A4/A6 + discipline.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -z "${SPECULUM_MONOREPO_ROOT:-}" ]]; then
  echo "FAIL run-phase10: SPECULUM_MONOREPO_ROOT required" >&2
  exit 1
fi

echo "=== phase10 — test discipline (5 rules) ==="
bash scripts/ci/assert-test-discipline.sh

echo "=== phase10 — supervisor Kind/ControlAbi grep + A2 policy locus ==="
bash scripts/ci/assert-phase10-supervisor.sh

echo "=== phase10 — schema hash three tips ==="
bash scripts/ci/assert-schema-hash.sh

echo "=== phase10 — .NET A2/A4/A6 units ==="
dotnet run -c Release --project tests/phase10/Phase10.Cs/Phase10.Cs.csproj

echo "=== phase10 — A3 SpecDriver corpus + ProjectionClient ==="
CORPUS="${SPECULUM_PHASE10_CORPUS:-$ROOT/build/phase10/builtAt_corpus.json}"
mkdir -p "$(dirname "$CORPUS")"
# Build + run SpecDriver corpus emitter (sim).
bash scripts/ci/build-phase10-corpus.sh
"$ROOT/build/phase10/builtAt_corpus" "$CORPUS" \
  "$ROOT/tests/phase7/fixtures/correcao/attr-text.spec"
export SPECULUM_PHASE10_CORPUS="$CORPUS"
node tests/phase10/phase10-builtAt.mjs

echo "=== phase10 — A5 lab E2E SessionHost + FakeMotor ==="
bash scripts/ci/run-phase10-lab-e2e.sh

echo "=== phase10 PASS ==="

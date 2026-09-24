#!/usr/bin/env bash
# One green command for gecko-engine redesign gates + SpeculumPhase 7/8/9 gtests.
# Static checks run before any libxul build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -z "${SPECULUM_MONOREPO_ROOT:-}" ]]; then
  echo "FAIL ci:all: SPECULUM_MONOREPO_ROOT is not set." >&2
  echo "  export SPECULUM_MONOREPO_ROOT=/path/to/Websete\\ Speculum" >&2
  echo "  (must contain packages/page-projection — required by digest + lab-schema-ingest)" >&2
  exit 1
fi
if [[ ! -d "$SPECULUM_MONOREPO_ROOT" ]]; then
  echo "FAIL ci:all: SPECULUM_MONOREPO_ROOT does not exist: $SPECULUM_MONOREPO_ROOT" >&2
  echo "  export SPECULUM_MONOREPO_ROOT=/path/to/Websete\\ Speculum" >&2
  exit 1
fi
if [[ ! -d "$SPECULUM_MONOREPO_ROOT/packages/page-projection" ]]; then
  echo "FAIL ci:all: missing packages/page-projection under SPECULUM_MONOREPO_ROOT=$SPECULUM_MONOREPO_ROOT" >&2
  echo "  export SPECULUM_MONOREPO_ROOT=/path/to/Websete\\ Speculum" >&2
  exit 1
fi

echo "=== ci:all — test discipline (5 permanent rules) ==="
bash scripts/ci/assert-test-discipline.sh

echo "=== ci:all — static gtest registration (no build) ==="
bash scripts/ci/assert-gtest-registration.sh

echo "=== ci:all — layer gates ==="
bash scripts/phase1/layer_gates.sh

echo "=== ci:all — observer / script / policy textual ==="
bash scripts/ci/assert-observer-no-script.sh

echo "=== ci:all — digest C++×TS ==="
bash scripts/ci/assert-digest-parity.sh

echo "=== ci:all — lab schema ingest ==="
node tests/phase9/lab-schema-ingest.mjs

echo "=== ci:all — Phase 10 supervisor / client / hash ==="
bash scripts/ci/run-phase10.sh

echo "=== ci:all — mach gtest Phase 7 / 8 / 9 (name-set checked) ==="
bash scripts/ci/run-speculum-gtest.sh SpeculumPhase7
bash scripts/ci/run-speculum-gtest.sh SpeculumPhase8
bash scripts/ci/run-speculum-gtest.sh SpeculumPhase9
export SPECULUM_DIGEST_SUITE_DIR="${SPECULUM_PHASE9_DIGEST_OUT:-$ROOT/tests/phase9/suite_patches}"
bash scripts/ci/assert-digest-parity.sh

echo "=== ci:all PASS ==="

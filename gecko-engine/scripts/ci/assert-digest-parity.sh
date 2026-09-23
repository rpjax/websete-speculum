#!/usr/bin/env bash
# Phase 9 — Digest C++ × TS parity over committed vectors (+ optional suite dumps).
# Requires SPECULUM_MONOREPO_ROOT (or SPECULUM_PAGE_PROJECTION). No ../ deduction.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VEC="$ROOT/tests/phase9/digest_vectors.json"
SCRIPT="$ROOT/tests/phase9/digest_parity.mjs"
fail=0

if [[ ! -f "$VEC" ]]; then
  echo "FAIL: missing $VEC" >&2
  exit 1
fi
if [[ ! -f "$SCRIPT" ]]; then
  echo "FAIL: missing $SCRIPT" >&2
  exit 1
fi

if [[ -z "${SPECULUM_PAGE_PROJECTION:-}" ]]; then
  if [[ -z "${SPECULUM_MONOREPO_ROOT:-}" ]]; then
    echo "FAIL assert-digest-parity: set SPECULUM_MONOREPO_ROOT (monorepo root containing packages/page-projection) or SPECULUM_PAGE_PROJECTION" >&2
    echo "  WSL engine-only trees do not include packages/ — do not infer path from this script's location." >&2
    exit 1
  fi
  if [[ ! -d "$SPECULUM_MONOREPO_ROOT" ]]; then
    echo "FAIL assert-digest-parity: SPECULUM_MONOREPO_ROOT does not exist: $SPECULUM_MONOREPO_ROOT" >&2
    exit 1
  fi
  export SPECULUM_PAGE_PROJECTION="$SPECULUM_MONOREPO_ROOT/packages/page-projection"
fi

if [[ ! -f "$SPECULUM_PAGE_PROJECTION/src/core/digestBytes.ts" ]]; then
  echo "FAIL assert-digest-parity: missing digestBytes.ts under SPECULUM_PAGE_PROJECTION=$SPECULUM_PAGE_PROJECTION" >&2
  exit 1
fi

export SPECULUM_DIGEST_VECTORS="$VEC"
# Suite dumps from Phase9 gtest (ci:all sets SPECULUM_PHASE9_DIGEST_OUT → suite_patches)
if [[ -n "${SPECULUM_PHASE9_DIGEST_OUT:-}" ]]; then
  export SPECULUM_DIGEST_SUITE_DIR="$SPECULUM_PHASE9_DIGEST_OUT"
fi

# Planted probe: empty/missing package path must fail
probe_pp="$ROOT/tests/phase9/.gate_probe_pp"
rm -rf "$probe_pp"
mkdir -p "$probe_pp"
if SPECULUM_PAGE_PROJECTION="$probe_pp" SPECULUM_DIGEST_VECTORS="$VEC" node "$SCRIPT" >/dev/null 2>&1; then
  echo "FAIL: assert-digest-parity did not detect planted empty page-projection" >&2
  fail=1
else
  echo "PASS: assert-digest-parity closes"
fi
rm -rf "$probe_pp"

node "$SCRIPT"
if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
echo "OK assert-digest-parity"

#!/usr/bin/env bash
# Phase 10 A6 — schema hash identical on C++ / TS / C# generated tips.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

CPP="$(tr -d '[:space:]' < domain/wire/gen/schema.sha256)"
TS="$(grep -E '^export const SCHEMA_SHA256' wire-clients/ts/speculum_wire.gen.ts \
  | sed -E 's/.*"([0-9a-f]+)".*/\1/')"
CS="$(grep -E 'public const string Sha256' wire-clients/cs/SpeculumWire.gen.cs \
  | sed -E 's/.*"([0-9a-fA-F]+)".*/\1/' | tr 'A-F' 'a-f')"

fail=0
if [[ -z "$CPP" || -z "$TS" || -z "$CS" ]]; then
  echo "FAIL schema-hash: empty tip (cpp='$CPP' ts='$TS' cs='$CS')"
  exit 1
fi

echo "schema tips: cpp=$CPP ts=$TS cs=$CS"

if [[ "$CPP" != "$TS" ]]; then
  echo "FAIL schema_hash_mismatch: cpp≠ts expected=$CPP got=$TS"
  fail=1
fi
if [[ "$CPP" != "$CS" ]]; then
  echo "FAIL schema_hash_mismatch: cpp≠cs expected=$CPP got=$CS"
  fail=1
fi

# Mirror into page-projection package tip.
MONO="${SPECULUM_MONOREPO_ROOT:-}"
if [[ -n "$MONO" && -f "$MONO/packages/page-projection/src/wire/speculum_wire.gen.ts" ]]; then
  PP="$(grep -E '^export const SCHEMA_SHA256' \
    "$MONO/packages/page-projection/src/wire/speculum_wire.gen.ts" \
    | sed -E 's/.*"([0-9a-f]+)".*/\1/')"
  if [[ "$CPP" != "$PP" ]]; then
    echo "FAIL schema_hash_mismatch: cpp≠page-projection expected=$CPP got=$PP"
    fail=1
  else
    echo "PASS page-projection tip matches"
  fi
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
echo "PASS schema-hash three tips"

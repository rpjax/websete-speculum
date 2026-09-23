#!/usr/bin/env bash
# Count-checked SpeculumPhaseN gtest via the single container contract: w7s gecko shell.
# Does not repair mozbuild / images / mounts — that is w7s bootstrap + make.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EXPECT="$ROOT/scripts/ci/speculum-gtest-expect.txt"
SUITE="${1:?usage: run-speculum-gtest.sh SpeculumPhaseN}"

declare -A want=()
while IFS= read -r line || [[ -n "${line:-}" ]]; do
  [[ -z "${line:-}" || "$line" =~ ^# ]] && continue
  if [[ "$line" != *$'\t'* ]]; then
    echo "FAIL run-speculum-gtest: malformed expect line (Suite\\tCase): $line" >&2
    exit 1
  fi
  s="${line%%$'\t'*}"
  c="${line#*$'\t'}"
  [[ "$s" == "$SUITE" ]] || continue
  want["$c"]=1
done <"$EXPECT"

if [[ ${#want[@]} -lt 1 ]]; then
  echo "FAIL run-speculum-gtest: no expect rows for $SUITE in $EXPECT" >&2
  exit 1
fi

if [[ "$SUITE" == "SpeculumPhase9" ]]; then
  # Host path for suite digests. Container dump needs w7s to forward
  # SPECULUM_PHASE9_DIGEST_OUT (shell lacuna — see report); gate still owns the dir.
  export SPECULUM_PHASE9_DIGEST_OUT="${SPECULUM_PHASE9_DIGEST_OUT:-$ROOT/tests/phase9/suite_patches}"
  mkdir -p "$SPECULUM_PHASE9_DIGEST_OUT"
fi

log="$(mktemp)"
cleanup() { rm -f "$log"; }
trap cleanup EXIT

cd "$ROOT"
set +e
# Single contract — mounts/env/image are w7s's. Gate only wraps and checks names.
npx w7s gecko shell -- ./mach gtest "${SUITE}.*" 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}
set -e

if grep -q 'the input device is not a TTY' "$log"; then
  echo "FAIL $SUITE: w7s gecko shell requires a TTY (docker -it)." >&2
  echo "  Lacuna @rodrigopjax/w7s: shell must use -i without -t when stdout is not a TTY," >&2
  echo "  and must attach the same build mounts as 'w7s gecko make gecko-binary'." >&2
  echo "  Do not reintroduce a hand-rolled docker run in this gate." >&2
  exit 1
fi

# Collect TEST_START / Suite.Case lines mach prints.
declare -A got=()
while IFS= read -r line; do
  # e.g. TEST_START: SpeculumPhase9.DigestVectors
  if [[ "$line" =~ TEST_START:[[:space:]]*${SUITE}\.([A-Za-z0-9_]+) ]]; then
    got["${BASH_REMATCH[1]}"]=1
  fi
done <"$log"

fail=0
for c in "${!want[@]}"; do
  if [[ -z "${got[$c]+x}" ]]; then
    echo "FAIL $SUITE: expected case missing from mach output: $c" >&2
    fail=1
  fi
done
for c in "${!got[@]}"; do
  if [[ -z "${want[$c]+x}" ]]; then
    echo "FAIL $SUITE: unexpected case in mach output: $c" >&2
    fail=1
  fi
done

if [[ ${#got[@]} -eq 0 ]]; then
  echo "FAIL $SUITE: no TEST_START lines for $SUITE (gate did no work; rc=$rc)" >&2
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "FAIL $SUITE: case set mismatch (want ${#want[@]}, got ${#got[@]}, rc=$rc)" >&2
  exit 1
fi

if [[ "$rc" -ne 0 ]]; then
  echo "FAIL $SUITE: mach exited $rc (case set matched ${#got[@]} names)" >&2
  exit "$rc"
fi

echo "PASS $SUITE: ${#got[@]} case(s) matched expect set"

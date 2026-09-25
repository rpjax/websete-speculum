#!/usr/bin/env bash
# Phase 11 — ratio gates + planted probes. Same-run numbers only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

THRESH="$ROOT/tests/phase11/thresholds.json"
REPORT_DIR="$ROOT/tests/phase11/reports"
PROBE_DIR="$ROOT/.gate_probes_phase11"
rm -rf "$PROBE_DIR"
mkdir -p "$PROBE_DIR" "$REPORT_DIR"

fail=0

# --- Probe: missing threshold key must fail ---
plant_missing="$PROBE_DIR/thresholds-missing.json"
printf '%s\n' '{ "R_flat_max": 2.0, "declaredBeforeMeasure": true }' >"$plant_missing"
# Build once; reuse binary for probes + real run.
bash scripts/ci/build-phase11.sh
BIN="$ROOT/build/phase11/phase11_tests"
if [[ ! -x "$BIN" ]]; then
  echo "FAIL run-phase11: binary missing" >&2
  exit 1
fi

set +e
"$BIN" --thresholds "$plant_missing" --report-dir "$PROBE_DIR/reports-missing" >/dev/null 2>&1
rc_missing=$?
set -e
if [[ "$rc_missing" -eq 0 ]]; then
  echo "FAIL R_probe: missing limiar did not fail" >&2
  fail=1
else
  echo "PASS R_probe: missing limiar fails"
fi

# --- Probe: forced high ratio must fail ---
set +e
"$BIN" --thresholds "$THRESH" --report-dir "$PROBE_DIR/reports-force" --force-fail-ratio >/dev/null 2>&1
rc_force=$?
set -e
if [[ "$rc_force" -eq 0 ]]; then
  echo "FAIL R_probe: forced high ratio did not fail" >&2
  fail=1
else
  echo "PASS R_probe: forced high ratio fails"
fi

# --- Real same-run gate ---
export SPECULUM_COMMIT="${SPECULUM_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"
set +e
"$BIN" --thresholds "$THRESH" --report-dir "$REPORT_DIR"
rc_real=$?
set -e
if [[ "$rc_real" -ne 0 ]]; then
  echo "FAIL run-phase11: ratio harness" >&2
  fail=1
else
  echo "PASS run-phase11: ratio harness"
fi

if [[ ! -f "$REPORT_DIR/latest.json" ]]; then
  echo "FAIL run-phase11: latest.json missing" >&2
  fail=1
fi

echo "=== phase11 — signal baseline (defaults + STR_DEF; never a fail gate) ==="
set +e
bash scripts/ci/assert-phase11-signal.sh
sig_rc=$?
set -e
if [[ "$sig_rc" -ne 0 ]]; then
  echo "SIGNAL phase11-baseline: drift registered (not a gate)" >&2
fi

rm -rf "$PROBE_DIR"

if [[ "$fail" -ne 0 ]]; then
  echo "FAIL phase11" >&2
  exit 1
fi
echo "PASS phase11"

#!/usr/bin/env bash
# Phase 11 signal baseline — three launch knobs + STR_DEF decision.
# Registered signal only — never a fail gate for ci:all (run-phase11 ignores exit ≠ 0).
# Absolutes (us/op) are printed as SIGNAL only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$ROOT/tests/phase11/baseline.json"
LATEST="$ROOT/tests/phase11/reports/latest.json"

if [[ ! -f "$BASE" ]]; then
  echo "SIGNAL phase11-signal: missing baseline.json" >&2
  exit 1
fi
if [[ ! -f "$LATEST" ]]; then
  echo "SIGNAL phase11-signal: missing reports/latest.json (run harness first)" >&2
  exit 1
fi

BASE="$BASE" LATEST="$LATEST" node <<'EOF'
const fs = require('fs');
const base = JSON.parse(fs.readFileSync(process.env.BASE, 'utf8'));
const latest = JSON.parse(fs.readFileSync(process.env.LATEST, 'utf8'));
const drift = [];

function eq(path, a, b) {
  if (a !== b) drift.push(`${path}: baseline=${JSON.stringify(a)} latest=${JSON.stringify(b)}`);
}

eq('defaults.kPatchClockIntervalMs', base.defaults.kPatchClockIntervalMs, latest.defaults.kPatchClockIntervalMs);
eq('defaults.kScratchCapacityBytes', base.defaults.kScratchCapacityBytes, latest.defaults.kScratchCapacityBytes);
eq('defaults.kMaxConcurrentAssetStreams', base.defaults.kMaxConcurrentAssetStreams, latest.defaults.kMaxConcurrentAssetStreams);
eq('interning.decision', base.interning.decision, latest.interning.decision);

const us = latest.usPerOp || {};
console.log(`SIGNAL us/op K100=${us.K100} K400=${us.K400} K1600=${us.K1600} (not a gate)`);
console.log(`SIGNAL scratchPeak=${latest.scratchPeak} scratchMedian=${latest.scratchMedian} (not a gate)`);
console.log(`SIGNAL R_vocab=${latest.interning && latest.interning.R_vocab} decision=${latest.interning && latest.interning.decision}`);
console.log(`SIGNAL defaults cadence=${latest.defaults.kPatchClockIntervalMs}ms scratch=${latest.defaults.kScratchCapacityBytes} streams=${latest.defaults.kMaxConcurrentAssetStreams}`);

if (drift.length) {
  console.error('SIGNAL phase11-baseline: drift (not a gate):');
  for (const f of drift) console.error('  ' + f);
  process.exit(1);
}
console.log('SIGNAL phase11-baseline: defaults + STR_DEF match baseline');
EOF

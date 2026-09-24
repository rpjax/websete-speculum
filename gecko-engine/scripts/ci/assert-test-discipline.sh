#!/usr/bin/env bash
# Five permanent test-discipline rules. Each has a planted probe that must fire.
# No filename allowlists for product/tests under scan.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

fail=0
PROBE_DIR="$ROOT/.gate_probes_test_discipline"
rm -rf "$PROBE_DIR"
mkdir -p "$PROBE_DIR"

scan_roots=("$ROOT/tests" "$ROOT/supervisor/src")
if [[ -n "${SPECULUM_MONOREPO_ROOT:-}" && -d "${SPECULUM_MONOREPO_ROOT}/packages/page-projection" ]]; then
  scan_roots+=("${SPECULUM_MONOREPO_ROOT}/packages/page-projection/src")
fi

list_sources() {
  # -print0: paths may contain spaces (e.g. Windows checkout under /mnt/c/.../Websete Speculum).
  find "${scan_roots[@]}" -type f \( \
      -name '*.cs' -o -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.js' -o \
      -name '*.cpp' -o -name '*.hpp' -o -name '*.sh' \) \
    ! -path '*/bin/*' ! -path '*/obj/*' ! -path '*/dist/*' ! -path '*/node_modules/*' \
    ! -path '*/.gate_probes_test_discipline/*' \
    -print0 2>/dev/null || true
}

# --- Rule 1: dual schema tip detectable ---
plant_hash="$PROBE_DIR/fake_tip.ts"
printf '%s\n' 'export const SCHEMA_SHA256 = "0000000000000000000000000000000000000000000000000000000000000000";' >"$plant_hash"
real="$(tr -d '[:space:]' < domain/wire/gen/schema.sha256)"
fake="$(grep -oE '[0-9a-f]{64}' "$plant_hash" | head -1)"
if [[ "$real" == "$fake" ]]; then
  echo "FAIL R1: planted dual hash collided with real tip" >&2
  fail=1
else
  echo "PASS R1: dual schema tip detectable (planted≠real)"
fi
rm -f "$plant_hash"

# --- Rule 2: unfailable asserts ---
# Probe first (simple form — nested parens break [^)]*).
plant2="$PROBE_DIR/unfailable.cs"
printf '%s\n' 'Check(ok || true, "probe");' >"$plant2"
plant2_hit="$(grep -nE 'Check\([^)]*\|\|[ ]*true' "$plant2" || true)"
rm -f "$plant2"
if [[ -z "$plant2_hit" ]]; then
  echo "FAIL R2: planted || true not detected" >&2
  fail=1
else
  echo "PASS R2: unfailable-assert probe fires"
fi
r2_hits="$(list_sources | xargs -0 -r grep -nE \
  'Check\([^)]*\|\|[ ]*true|assert\([^)]*\|\|[ ]*true|\.Length\s*>=\s*0[,)]|Check\(\s*true\s*,|expect\(true\)' \
  2>/dev/null || true)"
if [[ -n "$r2_hits" ]]; then
  echo "FAIL R2: unfailable assert patterns in tree:" >&2
  echo "$r2_hits" >&2
  fail=1
else
  echo "PASS R2: no unfailable asserts in scanned sources"
fi

# --- Rule 3: CI gates must not rewrite product ---
# Scan sibling ci scripts only — not this file (it mentions the banned tokens as detectors).
r3_hits="$(find "$ROOT/scripts/ci" -type f -name '*.sh' ! -name 'assert-test-discipline.sh' -print0 2>/dev/null \
  | xargs -0 -r grep -nE '(^|[^[:alnum:]_])sed -i|perl -i|npm install --force' 2>/dev/null || true)"
plant3="$PROBE_DIR/mutate_gate.sh"
printf '%s\n' 'sed -i "s/FAIL/PASS/" product.cs' >"$plant3"
plant3_hit="$(grep -nE 'sed -i' "$plant3" || true)"
rm -f "$plant3"
if [[ -z "$plant3_hit" ]]; then
  echo "FAIL R3: planted sed -i not detected" >&2
  fail=1
else
  echo "PASS R3: mutate-gate probe fires"
fi
if [[ -n "$r3_hits" ]]; then
  echo "FAIL R3: gate mutates environment/product:" >&2
  echo "$r3_hits" >&2
  fail=1
else
  echo "PASS R3: gates do not sed -i product"
fi

# --- Rule 4: no implicit monorepo root ---
r4_hits="$(list_sources | xargs -0 -r grep -nE \
  'join\(__dirname,\s*[`'\'']\.\./\.\./\.\.|\.\./\.\./packages/page-projection|\.\./packages/page-projection' \
  2>/dev/null || true)"
plant4="$PROBE_DIR/implicit_root.mjs"
printf '%s\n' 'const root=join(dirname(fileURLToPath(import.meta.url)),"../../..");' >"$plant4"
plant4_hit="$(grep -nE '\.\./\.\./\.\.' "$plant4" || true)"
rm -f "$plant4"
if [[ -z "$plant4_hit" ]]; then
  echo "FAIL R4: planted implicit root not detected" >&2
  fail=1
else
  echo "PASS R4: implicit-root probe fires"
fi
if [[ -n "$r4_hits" ]]; then
  echo "FAIL R4: implicit root / parent-walk in sources:" >&2
  echo "$r4_hits" >&2
  fail=1
else
  echo "PASS R4: no implicit monorepo root deduction"
fi

# --- Rule 5: no source-Contains as PASS ---
r5_hits="$(list_sources | xargs -0 -r grep -nE \
  'Contains\("Send[A-Z]|Contains\("SchemaCommands|includes\("Send[A-Z]|includes\('\''Send[A-Z]|includes\("enterSchema|includes\('\''enterSchema' \
  2>/dev/null || true)"
plant5="$PROBE_DIR/contains_src.cs"
printf '%s\n' 'Check(src.Contains("SendViewportOpenAsync"), "A5");' >"$plant5"
plant5_hit="$(grep -nE 'Contains\("Send' "$plant5" || true)"
rm -f "$plant5"
if [[ -z "$plant5_hit" ]]; then
  echo "FAIL R5: planted Contains(Send…) not detected" >&2
  fail=1
else
  echo "PASS R5: source-Contains probe fires"
fi
if [[ -n "$r5_hits" ]]; then
  echo "FAIL R5: source-inspection as pass:" >&2
  echo "$r5_hits" >&2
  fail=1
else
  echo "PASS R5: no source-Contains pass patterns"
fi

rm -rf "$PROBE_DIR"

if [[ "$fail" -ne 0 ]]; then
  echo "FAIL assert-test-discipline" >&2
  exit 1
fi
echo "PASS assert-test-discipline (5 rules + probes)"

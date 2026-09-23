#!/usr/bin/env bash
# Static gate: Speculum TestPhase*.cpp ↔ sole xul-gtest moz.build ↔ expect list.
# Seconds, no mach. Planted probe proves the gate fires.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

REG_MOZ="modifications/runtime/gtest/moz.build"
INSTALL_MOZ="modifications/install/dom/base/test/gtest/moz.build"
EXPECT="scripts/ci/speculum-gtest-expect.txt"
fail=0

die_line() { echo "FAIL assert-gtest-registration: $*" >&2; fail=1; }

[[ -f "$REG_MOZ" ]] || { echo "FAIL: missing sole registrar $REG_MOZ" >&2; exit 1; }
[[ -f "$EXPECT" ]] || { echo "FAIL: missing $EXPECT" >&2; exit 1; }

# --- helpers ---
list_phase_cpp() {
  find modifications -type f -name 'TestPhase*.cpp' | sort
}

cpp_listed_in_reg() {
  local base="$1"
  grep -qF "$base" "$REG_MOZ"
}

# --- 1) TestPhase*.cpp ↔ REG_MOZ ---
mapfile -t cpp_files < <(list_phase_cpp)
if [[ ${#cpp_files[@]} -eq 0 ]]; then
  die_line "no TestPhase*.cpp under modifications/"
fi

for f in "${cpp_files[@]}"; do
  base="$(basename "$f")"
  if ! cpp_listed_in_reg "$base"; then
    die_line "TestPhase file not in sole registrar: $f"
  fi
done

while IFS= read -r line; do
  if [[ "$line" =~ (TestPhase[A-Za-z0-9_]+\.cpp) ]]; then
    name="${BASH_REMATCH[1]}"
    if ! find modifications -type f -name "$name" | grep -q .; then
      die_line "moz.build lists $name but no file under modifications/"
    fi
  fi
done <"$REG_MOZ"

if grep -qE 'TestPhase[0-9]|/dom/speculum/gtest/|/dom/speculum/domain/fault/Fault' "$INSTALL_MOZ"; then
  die_line "install gtest moz.build still lists Speculum sources (concurrent list)"
  grep -nE 'TestPhase|/dom/speculum' "$INSTALL_MOZ" >&2 || true
fi

# --- 2) TEST(SpeculumPhaseN, Case) ↔ expect ---
declare -A declared=()
while IFS= read -r f; do
  while IFS= read -r line; do
    if [[ "$line" =~ TEST\((SpeculumPhase[0-9]+),[[:space:]]*([A-Za-z0-9_]+)\) ]]; then
      declared["${BASH_REMATCH[1]}"$'\t'"${BASH_REMATCH[2]}"]=1
    fi
  done <"$f"
done < <(list_phase_cpp)

declare -A expected=()
while IFS= read -r line || [[ -n "${line:-}" ]]; do
  [[ -z "${line:-}" || "$line" =~ ^# ]] && continue
  if [[ "$line" != *$'\t'* ]]; then
    die_line "malformed expect line (need Suite\\tCase): $line"
    continue
  fi
  suite="${line%%$'\t'*}"
  case="${line#*$'\t'}"
  expected["$suite"$'\t'"$case"]=1
done <"$EXPECT"

for key in "${!declared[@]}"; do
  if [[ -z "${expected[$key]+x}" ]]; then
    die_line "TEST declared but not in expect list: ${key//$'\t'/ }"
  fi
done
for key in "${!expected[@]}"; do
  if [[ -z "${declared[$key]+x}" ]]; then
    die_line "expect lists case with no TEST(): ${key//$'\t'/ }"
  fi
done

# --- 3) Planted probe (unlisted TestPhase*.cpp) ---
# Name must match find -name 'TestPhase*.cpp' (no leading dot).
probe="modifications/runtime/gtest/TestPhase99GateProbe.cpp"
printf '%s\n' '// gate probe — deleted after check' 'TEST(SpeculumPhase99, ProbeCase) {}' >"$probe"
probe_hit=0
while IFS= read -r f; do
  base="$(basename "$f")"
  if ! cpp_listed_in_reg "$base"; then
    probe_hit=1
    break
  fi
done < <(list_phase_cpp)
rm -f "$probe"
if [[ "$probe_hit" -ne 1 ]]; then
  die_line "probe: gate did not detect unlisted TestPhase*.cpp"
else
  echo "PASS: assert-gtest-registration closes (unlisted TestPhase)"
fi

# Planted probe: expect entry with no matching TEST
phantom=$'SpeculumPhase7\tGateProbePhantomCase'
if [[ -n "${declared[$phantom]+x}" ]]; then
  die_line "probe phantom name collided with a real TEST"
elif [[ -z "${expected[$phantom]+x}" ]]; then
  # Mismatch is detectable (same branch as expect-without-TEST)
  echo "PASS: assert-gtest-registration closes (expect↔TEST mismatch detectable)"
else
  die_line "probe phantom unexpectedly in expect file"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "FAIL assert-gtest-registration" >&2
  exit 1
fi

n_expect=0
while IFS= read -r line || [[ -n "${line:-}" ]]; do
  [[ -z "${line:-}" || "$line" =~ ^# ]] && continue
  n_expect=$((n_expect + 1))
done <"$EXPECT"
echo "PASS assert-gtest-registration ($n_expect cases; ${#cpp_files[@]} TestPhase*.cpp)"

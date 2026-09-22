#!/usr/bin/env bash
# Layer gates for redesign domain/ + ports/ (01-alvo §3.1 + noreturn ban).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

fail=0

# Text sources only — never scan golden binaries.
sources() {
  find domain ports -type f \( \
    -name '*.hpp' -o -name '*.h' -o -name '*.cpp' -o -name '*.c' -o \
    -name '*.md' -o -name '*.txt' -o -name '*.toml' -o -name '*.json' -o \
    -name '*.ts' -o -name '*.cs' \) \
    ! -path '*/testdata/*' 2>/dev/null || true
}

if sources | xargs -r grep -lE '"ns[A-Z]|mozilla/|nsI[A-Z]' 2>/dev/null | grep -q .; then
  echo "FAIL: gecko symbols in domain/ or ports/"
  sources | xargs -r grep -nE '"ns[A-Z]|mozilla/|nsI[A-Z]' || true
  fail=1
else
  echo "PASS: layer_gate_ns"
fi

if sources | xargs -r grep -lE '\[\[noreturn\]\]' 2>/dev/null | grep -q .; then
  echo "FAIL: [[noreturn]] in domain/"
  fail=1
else
  echo "PASS: layer_gate_noreturn"
fi

probe="domain/.gate_probe_ns.tmp.cpp"
printf '%s\n' '#include "nsIFoo.h"' >"$probe"
if ! sources | xargs -r grep -lE '"ns[A-Z]|mozilla/|nsI[A-Z]' 2>/dev/null | grep -q .; then
  echo "FAIL: layer_gate_ns did not detect planted nsI"
  fail=1
else
  echo "PASS: layer_gate_ns closes"
fi
rm -f "$probe"

probe2="domain/.gate_probe_nr.tmp.cpp"
printf '%s\n' '[[noreturn]] void die();' >"$probe2"
if ! sources | xargs -r grep -lE '\[\[noreturn\]\]' 2>/dev/null | grep -q .; then
  echo "FAIL: layer_gate_noreturn did not detect planted attribute"
  fail=1
else
  echo "PASS: layer_gate_noreturn closes"
fi
rm -f "$probe2"

exit "$fail"

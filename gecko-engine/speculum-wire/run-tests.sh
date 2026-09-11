#!/usr/bin/env bash
# Speculum wire core — compila o C++ e prova paridade com o cliente TypeScript.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${SPECULUM_OUT:-/tmp/speculum-wire}"
mkdir -p "$OUT"

"${CXX:-g++}" -std=c++17 -O2 -Wall -Wextra -I"$HERE/include" \
  "$HERE/test/wire_roundtrip.cpp" -o "$OUT/wire_test"
"$OUT/wire_test" "$OUT"

cd "$HERE/test"
SPECULUM_OUT="$OUT" npx --yes tsx verify.ts

python3 "$HERE/test/compare.py" "$OUT"

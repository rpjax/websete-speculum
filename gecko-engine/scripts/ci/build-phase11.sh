#!/usr/bin/env bash
# Build Phase 11 same-run ratio harness (sim).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
OUT_DIR="$ROOT/build/phase11"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/phase11_tests"

if command -v c++ >/dev/null 2>&1; then
  CXX=c++
elif command -v clang++ >/dev/null 2>&1; then
  CXX=clang++
elif command -v g++ >/dev/null 2>&1; then
  CXX=g++
else
  echo "FAIL build-phase11: need c++/clang++/g++ (run inside w7s gecko shell)" >&2
  exit 1
fi

"$CXX" -std=c++20 -O2 -DNDEBUG -I"$ROOT" -o "$OUT" \
  domain/fault/Fault.cpp \
  tests/phase11/phase11_tests.cpp
echo "PASS build phase11_tests → $OUT"

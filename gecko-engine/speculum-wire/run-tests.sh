#!/usr/bin/env bash
# Speculum wire core — compila o C++ e prova paridade com o cliente TypeScript.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${SPECULUM_OUT:-/tmp/speculum-wire}"
mkdir -p "$OUT"

"${CXX:-g++}" -std=c++17 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti -I"$HERE/include" \
  "$HERE/test/wire_roundtrip.cpp" -o "$OUT/wire_test"
"$OUT/wire_test" "$OUT"

"${CXX:-g++}" -std=c++17 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti -I"$HERE/include" \
  "$HERE/test/table_parity.cpp" -o "$OUT/table_test"
"$OUT/table_test" "$HERE/test/table_script.txt" "$OUT/table_cpp.json"

"${CXX:-g++}" -std=c++17 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti -I"$HERE/include" \
  "$HERE/test/producer_loop.cpp" -o "$OUT/producer_test"
"$OUT/producer_test" "$OUT"

"${CXX:-g++}" -std=c++17 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti -I"$HERE/include" \
  "$HERE/test/producer_nested.cpp" -o "$OUT/producer_nested"
"$OUT/producer_nested"

"${CXX:-g++}" -std=c++17 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti -I"$HERE/include" \
  "$HERE/test/producer_resync.cpp" -o "$OUT/producer_resync"
"$OUT/producer_resync"

"${CXX:-g++}" -std=c++17 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti -I"$HERE/include" \
  "$HERE/test/producer_lifecycle.cpp" -o "$OUT/producer_lifecycle"
"$OUT/producer_lifecycle"

"${CXX:-g++}" -std=c++17 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti -I"$HERE/include" \
  "$HERE/test/producer_shadow.cpp" -o "$OUT/producer_shadow"
"$OUT/producer_shadow"

"${CXX:-g++}" -std=c++17 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti -I"$HERE/include" \
  "$HERE/test/producer_cssom.cpp" -o "$OUT/producer_cssom"
"$OUT/producer_cssom"

"${CXX:-g++}" -std=c++17 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti -I"$HERE/include" \
  "$HERE/test/producer_cli.cpp" -o "$OUT/producer_cli"

cd "$HERE/test"
SPECULUM_OUT="$OUT" npx --yes tsx verify.ts
SPECULUM_OUT="$OUT" npx --yes tsx table_parity.ts
SPECULUM_OUT="$OUT" npx --yes tsx producer_loop.ts

python3 "$HERE/test/compare.py" "$OUT"

SPECULUM_LIVE_FRAMES="$HERE/evidence/live-frames" npx --yes tsx "$HERE/test/live_frames.ts"

SPECULUM_LIVE_INCREMENTAL="$HERE/evidence/live-incremental" npx --yes tsx "$HERE/test/live_incremental.ts"

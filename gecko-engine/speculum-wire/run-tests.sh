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

python3 - "$OUT/producer_cli" <<'PY'
import subprocess, sys
cli = sys.argv[1]
script = "boot\nsnapshot\nhalt\nmk div parked\nappend body parked\nsnapshot\nflush\nsnapshot\n"
out = subprocess.check_output([cli], input=script, text=True)
snaps = [line.split()[1] for line in out.splitlines() if line.startswith("SNAP ")]
if len(snaps) < 3:
    sys.stderr.write("FALHOU CLI iso: snapshots de menos\n" + out)
    sys.exit(1)
def table_hash(hx):
    return hx[24:40]
if table_hash(snaps[0]) != table_hash(snaps[1]):
    sys.stderr.write("FALHOU CLI iso: halt+append mudou tableHash sem Flush\n")
    sys.exit(1)
if table_hash(snaps[1]) == table_hash(snaps[2]):
    sys.stderr.write("FALHOU CLI iso: Flush nao mudou tableHash\n")
    sys.exit(1)
print("ok: CLI halt/flush snapshot (tableHash)")
PY

cd "$HERE/test"
SPECULUM_OUT="$OUT" npx --yes tsx verify.ts
SPECULUM_OUT="$OUT" npx --yes tsx table_parity.ts
SPECULUM_OUT="$OUT" npx --yes tsx producer_loop.ts

python3 "$HERE/test/compare.py" "$OUT"

SPECULUM_LIVE_FRAMES="$HERE/evidence/live-frames" npx --yes tsx "$HERE/test/live_frames.ts"

SPECULUM_LIVE_INCREMENTAL="$HERE/evidence/live-incremental" npx --yes tsx "$HERE/test/live_incremental.ts"

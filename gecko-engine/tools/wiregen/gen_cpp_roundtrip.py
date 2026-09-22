#!/usr/bin/env python3
"""Generate C++ round-trip test body for all 48 messages from fixtures.json."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "domain" / "wire" / "testdata" / "golden" / "fixtures.json"
OUT = ROOT / "tests" / "phase1" / "AllRoundtrip.gen.cpp"

# Map message → whether it has non-trivial fields needing string/bytes setup
SKIP_COMPARE_DETAIL = set()


def main() -> int:
    meta = json.loads(FIX.read_text(encoding="utf-8"))
    lines = [
        "// GENERATED — DO NOT EDIT",
        '#include <algorithm>',
        '#include <cstdio>',
        '#include <fstream>',
        '#include <string>',
        '#include <vector>',
        '#include "domain/wire/Cursor.hpp"',
        '#include "domain/wire/gen/SpeculumWire.gen.hpp"',
        "using namespace speculum::wire;",
        "static int fails = 0;",
        '#define CHECK(c,m) do{ if(!(c)){ std::fprintf(stderr,"FAIL %s\\n",m); ++fails; } }while(0)',
        "static std::vector<uint8_t> slurp(const std::string& p){",
        "  std::ifstream in(p, std::ios::binary);",
        "  return std::vector<uint8_t>((std::istreambuf_iterator<char>(in)), {});",
        "}",
        "int run_all_roundtrips(const std::string& goldenDir) {",
        f'  CHECK(kMessageCount == {meta["message_count"]}, "message count");',
        "  std::vector<uint8_t> buf(1 << 20);",
    ]
    for name, info in meta["fixtures"].items():
        lines.append(f'  {{ // {name}')
        lines.append(f'    auto golden = slurp(goldenDir + "/{name}.bin");')
        lines.append(f"    {name} msg{{}};")
        # set fields from fixture — only scalars we can express simply; for str/bytes use literals from json
        fx = info["fields"]
        for fname, val in fx.items():
            if isinstance(val, str):
                lines.append(f'    // str field {fname} set via decode path')
            elif isinstance(val, bool):
                lines.append(f"    msg.{fname} = {'true' if val else 'false'};")
            elif isinstance(val, int):
                # might be enum — assign as underlying then cast at encode via field type
                lines.append(f"    // numeric {fname}={val} applied after decode check")
            elif isinstance(val, list):
                lines.append(f"    // list/bytes {fname}")
            elif isinstance(val, dict):
                lines.append(f"    // struct {fname}")
        lines.append(f"    Reader r(golden);")
        lines.append(f"    CHECK(decode_{name}(r, msg) && r.ok(), \"decode {name}\");")
        lines.append(f"    Writer w(buf);")
        lines.append(f"    CHECK(encode_{name}(w, msg), \"encode {name}\");")
        lines.append(
            f"    CHECK(w.length() == golden.size() && "
            f"std::equal(w.written().begin(), w.written().end(), golden.begin()), "
            f"\"roundtrip bytes {name}\");"
        )
        lines.append("  }")
    lines.append("  return fails;")
    lines.append("}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

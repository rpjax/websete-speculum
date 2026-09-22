#!/usr/bin/env python3
"""Emit one golden payload (.bin) per schema message + fixtures.json."""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from wiregen import DEFAULT_SCHEMA, field_type, load_schema, schema_hash  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "domain" / "wire" / "testdata" / "golden"


class Enc:
    def __init__(self) -> None:
        self.b = bytearray()

    def u8(self, v: int) -> None:
        self.b.append(v & 0xFF)

    def u16(self, v: int) -> None:
        self.b += struct.pack("<H", v)

    def u32(self, v: int) -> None:
        self.b += struct.pack("<I", v)

    def u64(self, v: int) -> None:
        self.b += struct.pack("<Q", v)

    def i32(self, v: int) -> None:
        self.b += struct.pack("<i", v)

    def boolean(self, v: bool) -> None:
        self.u8(1 if v else 0)

    def str_(self, v: str) -> None:
        raw = v.encode("utf-8")
        self.u32(len(raw))
        self.b += raw

    def bytes_(self, v: bytes) -> None:
        self.u32(len(v))
        self.b += v


def fixture_for(msg: dict, enums: dict, structs: dict) -> dict:
    """Deterministic non-empty fixture per message."""
    out: dict = {}
    for i, f in enumerate(msg.get("fields", [])):
        out[f["name"]] = sample(field_type(f), enums, structs, seed=i + 1)
    return out


def sample(ft: dict, enums: dict, structs: dict, seed: int = 1):
    k = ft["kind"]
    if k == "u8":
        return seed & 0xFF
    if k == "u16":
        return (0x1000 + seed) & 0xFFFF
    if k == "u32":
        return 0xA0000000 + seed
    if k == "u64":
        return 0xB000000000000000 + seed
    if k == "i32":
        return -1000 - seed
    if k == "bool":
        return seed % 2 == 0
    if k == "str":
        return f"s{seed}"
    if k == "bytes":
        return list(range(seed, seed + 3))
    if k == "enum":
        vals = enums[ft["name"]]["values"]
        return vals[seed % len(vals)]["number"]
    if k == "struct":
        s = structs[ft["name"]]
        return {sf["name"]: sample(field_type(sf), enums, structs, seed + 1) for sf in s["fields"]}
    if k == "list":
        n = min(2, ft["max"])
        return [sample(ft["inner"], enums, structs, seed + i) for i in range(n)]
    raise RuntimeError(ft)


def encode_value(enc: Enc, ft: dict, val, enums: dict, structs: dict) -> None:
    k = ft["kind"]
    if k == "u8":
        enc.u8(int(val))
    elif k == "u16":
        enc.u16(int(val))
    elif k == "u32":
        enc.u32(int(val))
    elif k == "u64":
        enc.u64(int(val))
    elif k == "i32":
        enc.i32(int(val))
    elif k == "bool":
        enc.boolean(bool(val))
    elif k == "str":
        enc.str_(str(val))
    elif k == "bytes":
        enc.bytes_(bytes(val))
    elif k == "enum":
        width = enums[ft["name"]]["width"]
        n = int(val)
        if width == "u8":
            enc.u8(n)
        elif width == "u16":
            enc.u16(n)
        else:
            enc.u32(n)
    elif k == "struct":
        s = structs[ft["name"]]
        for sf in s["fields"]:
            encode_value(enc, field_type(sf), val[sf["name"]], enums, structs)
    elif k == "list":
        enc.u8(len(val))
        for item in val:
            encode_value(enc, ft["inner"], item, enums, structs)
    else:
        raise RuntimeError(ft)


def main() -> int:
    data = load_schema(DEFAULT_SCHEMA)
    enums = {e["name"]: e for e in data["enum"]}
    structs = {s["name"]: s for s in data["struct"]}
    OUT.mkdir(parents=True, exist_ok=True)
    fixtures = {}
    for msg in data["message"]:
        name = msg["name"]
        fx = fixture_for(msg, enums, structs)
        fixtures[name] = {"opcode": msg["opcode"], "fields": fx}
        enc = Enc()
        for f in msg.get("fields", []):
            encode_value(enc, field_type(f), fx[f["name"]], enums, structs)
        (OUT / f"{name}.bin").write_bytes(bytes(enc.b))
    meta = {
        "schema_sha256": schema_hash(DEFAULT_SCHEMA),
        "message_count": len(data["message"]),
        "fixtures": fixtures,
    }
    (OUT / "fixtures.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"wrote {len(fixtures)} goldens to {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Speculum wiregen — TOML schema → C++ / TypeScript / C# codecs.

Generated files must not be hand-edited. Any schema rule violation is a BUILD error.
"""
from __future__ import annotations

import argparse
import hashlib
import re
import struct
import sys
from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib  # type: ignore

ROOT = Path(__file__).resolve().parents[2]  # gecko-engine/
DEFAULT_SCHEMA = (
    ROOT.parent / "docs" / "gecko-engine" / "redesign" / "schema" / "speculum.wire.toml"
)
OUT_CPP = ROOT / "domain" / "wire" / "gen"
OUT_TS = ROOT / "wire-clients" / "ts"
OUT_CS = ROOT / "wire-clients" / "cs"

PRIM = {"u8", "u16", "u32", "u64", "i32", "bool", "str", "bytes"}
TARGET_IN = {
    "session": {0x01, 0x0F},
    "viewport": {0x02},
    "host": {0x03, 0x04},
    "any": {0x0F},
}
TARGET_OUT = {
    "session": {0x81, 0x8F},
    "viewport": {0x82},
    "host": {0x83, 0x84},
    "any": {0x8F},
}


class SchemaError(Exception):
    def __init__(self, rule: int, msg: str):
        super().__init__(f"refuse#{rule}: {msg}")
        self.rule = rule


def parse_type(t: str) -> dict[str, Any]:
    t = t.strip()
    if t in PRIM:
        return {"kind": t}
    m = re.fullmatch(r"enum<(\w+)>", t)
    if m:
        return {"kind": "enum", "name": m.group(1)}
    m = re.fullmatch(r"struct<(\w+)>", t)
    if m:
        return {"kind": "struct", "name": m.group(1)}
    m = re.fullmatch(r"list<(.+)>\s*,?\s*max\s*=\s*(\d+)", t)
    if not m:
        # also accept list<T> max=N as separate in TOML as type string
        m = re.fullmatch(r'list<(.+)>"?\s*,?\s*max\s*=\s*(\d+)', t)
    if m:
        return {"kind": "list", "inner": parse_type(m.group(1)), "max": int(m.group(2))}
    # TOML may store as: list<struct<Metric>> with max in same string
    m = re.fullmatch(r"list<(.+)>", t)
    if m:
        return {"kind": "list", "inner": parse_type(m.group(1)), "max": None}
    raise SchemaError(6, f"unknown type {t!r}")


def field_type(f: dict) -> dict[str, Any]:
    raw = f["type"]
    # TOML: type = "list<struct<Metric>>", max = 16  OR embedded max=
    if "max" in f and isinstance(raw, str) and raw.startswith("list<"):
        inner = re.fullmatch(r"list<(.+)>", raw)
        if not inner:
            raise SchemaError(6, f"bad list type {raw!r}")
        parsed = {"kind": "list", "inner": parse_type(inner.group(1)), "max": int(f["max"])}
    elif isinstance(raw, str) and "max=" in raw:
        m = re.fullmatch(r"list<(.+)>\s*,?\s*max\s*=\s*(\d+)", raw)
        if not m:
            raise SchemaError(6, f"bad list type {raw!r}")
        parsed = {"kind": "list", "inner": parse_type(m.group(1)), "max": int(m.group(2))}
    else:
        parsed = parse_type(raw)
        if parsed["kind"] == "list" and parsed.get("max") is None and "max" in f:
            parsed["max"] = int(f["max"])
    if parsed["kind"] == "list":
        if parsed.get("max") is None:
            raise SchemaError(6, f"list without max: {raw!r}")
        if parsed["max"] > 255:
            raise SchemaError(6, f"list max > 255: {parsed['max']}")
    return parsed


def load_schema(path: Path) -> dict[str, Any]:
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    return data


def validate(data: dict[str, Any]) -> None:
    enums = {e["name"]: e for e in data.get("enum", [])}
    structs = {s["name"]: s for s in data.get("struct", [])}
    messages = data.get("message", [])

    # names
    seen_names: set[str] = set()
    for e in data.get("enum", []):
        if e["name"] in seen_names:
            raise SchemaError(4, f"duplicate enum name {e['name']}")
        seen_names.add(e["name"])
        vals = e.get("values", [])
        seen_v: set[int] = set()
        seen_n: set[str] = set()
        for v in vals:
            if "number" not in v:
                raise SchemaError(5, f"enum {e['name']} value {v.get('name')} missing number")
            if v["number"] in seen_v:
                raise SchemaError(5, f"enum {e['name']} duplicate value {v['number']}")
            if v["name"] in seen_n:
                raise SchemaError(4, f"enum {e['name']} duplicate field name {v['name']}")
            seen_v.add(v["number"])
            seen_n.add(v["name"])
        if e.get("width") not in ("u8", "u16", "u32"):
            raise SchemaError(6, f"enum {e['name']} bad width")

    for s in data.get("struct", []):
        if s["name"] in seen_names:
            raise SchemaError(4, f"duplicate struct name {s['name']}")
        seen_names.add(s["name"])
        fnames: set[str] = set()
        for f in s.get("fields", []):
            if f["name"] in fnames:
                raise SchemaError(4, f"struct {s['name']} duplicate field {f['name']}")
            fnames.add(f["name"])
            ft = field_type(f)
            _check_type_refs(ft, enums, structs)

    opcodes: dict[int, str] = {}
    msg_by_name: dict[str, dict] = {}
    for m in messages:
        name = m["name"]
        if name in seen_names or name in msg_by_name:
            raise SchemaError(4, f"duplicate message name {name}")
        msg_by_name[name] = m
        seen_names.add(name)
        op = int(m["opcode"])
        if op in opcodes:
            raise SchemaError(1, f"duplicate opcode 0x{op:04X} ({opcodes[op]} and {name})")
        opcodes[op] = name

        direction = m["direction"]
        if direction not in ("inbound", "outbound"):
            raise SchemaError(6, f"{name}: bad direction")
        bit = bool(op & 0x8000)
        if direction == "inbound" and bit:
            raise SchemaError(2, f"{name}: direction inbound but opcode high bit set")
        if direction == "outbound" and not bit:
            raise SchemaError(2, f"{name}: direction outbound but opcode high bit clear")

        target = m["target"]
        hi = (op >> 8) & 0xFF
        table = TARGET_IN if direction == "inbound" else TARGET_OUT
        if target not in table:
            raise SchemaError(3, f"{name}: unknown target {target}")
        if hi not in table[target]:
            raise SchemaError(
                3, f"{name}: opcode 0x{op:04X} hi=0x{hi:02X} disagrees with target={target}"
            )

        fnames = set()
        for f in m.get("fields", []):
            if f["name"] in fnames:
                raise SchemaError(4, f"message {name} duplicate field {f['name']}")
            fnames.add(f["name"])
            ft = field_type(f)
            _check_type_refs(ft, enums, structs)

    # pairs_with
    for m in messages:
        pw = m.get("pairs_with")
        if not pw:
            continue
        if pw not in msg_by_name:
            raise SchemaError(7, f"{m['name']}: pairs_with {pw} missing")
        other = msg_by_name[pw]
        if other["direction"] == m["direction"]:
            raise SchemaError(7, f"{m['name']}: pairs_with {pw} same direction")
        # reciprocal
        if other.get("pairs_with") != m["name"]:
            raise SchemaError(7, f"{m['name']}: pairs_with {pw} not reciprocal")

    if not messages:
        raise SchemaError(1, "no messages")


def _check_type_refs(ft: dict, enums: dict, structs: dict) -> None:
    if ft["kind"] == "enum":
        if ft["name"] not in enums:
            raise SchemaError(6, f"unknown enum {ft['name']}")
    elif ft["kind"] == "struct":
        if ft["name"] not in structs:
            raise SchemaError(6, f"unknown struct {ft['name']}")
    elif ft["kind"] == "list":
        _check_type_refs(ft["inner"], enums, structs)


def schema_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ── emitters ─────────────────────────────────────────────────────────────────

def cpp_type(ft: dict) -> str:
    k = ft["kind"]
    if k == "u8":
        return "uint8_t"
    if k == "u16":
        return "uint16_t"
    if k == "u32":
        return "uint32_t"
    if k == "u64":
        return "uint64_t"
    if k == "i32":
        return "int32_t"
    if k == "bool":
        return "bool"
    if k == "str":
        return "std::string_view"
    if k == "bytes":
        return "std::span<const uint8_t>"
    if k == "enum":
        return ft["name"]
    if k == "struct":
        return ft["name"]
    if k == "list":
        return f"std::array<{cpp_type(ft['inner'])}, {ft['max']}> /*count separate*/"
    raise RuntimeError(ft)


def emit_cpp(data: dict, h: str) -> str:
    lines = [
        "// GENERATED by wiregen — DO NOT EDIT",
        f"// schema_sha256={h}",
        "#pragma once",
        "#include <array>",
        "#include <cstdint>",
        "#include <span>",
        "#include <string_view>",
        '#include "domain/wire/Cursor.hpp"',
        "",
        "namespace speculum::wire {",
        "",
        f'inline constexpr char kSchemaSha256[] = "{h}";',
        f"inline constexpr std::size_t kMessageCount = {len(data.get('message', []))};",
        "",
    ]
    for e in data.get("enum", []):
        w = {"u8": "uint8_t", "u16": "uint16_t", "u32": "uint32_t"}[e["width"]]
        lines.append(f"enum class {e['name']} : {w} {{")
        for v in e["values"]:
            lines.append(f"  {v['name']} = {v['number']},")
        lines.append("};")
        lines.append("")

    for s in data.get("struct", []):
        lines.append(f"struct {s['name']} {{")
        for f in s.get("fields", []):
            ft = field_type(f)
            if ft["kind"] == "list":
                lines.append(f"  uint8_t {f['name']}_count{{}};")
                lines.append(
                    f"  std::array<{cpp_type(ft['inner'])}, {ft['max']}> {f['name']}{{}};"
                )
            else:
                lines.append(f"  {cpp_type(ft)} {f['name']}{{}};")
        lines.append("};")
        lines.append("")

    # forward encode/decode for structs
    for s in data.get("struct", []):
        lines.append(f"bool encode_{s['name']}(Writer& w, const {s['name']}& v);")
        lines.append(f"bool decode_{s['name']}(Reader& r, {s['name']}& v);")
    lines.append("")

    for m in data.get("message", []):
        lines.append(f"struct {m['name']} {{")
        lines.append(f"  static constexpr uint16_t kOpcode = 0x{int(m['opcode']):04X};")
        for f in m.get("fields", []):
            ft = field_type(f)
            if ft["kind"] == "list":
                lines.append(f"  uint8_t {f['name']}_count{{}};")
                lines.append(
                    f"  std::array<{cpp_type(ft['inner'])}, {ft['max']}> {f['name']}{{}};"
                )
            else:
                lines.append(f"  {cpp_type(ft)} {f['name']}{{}};")
        lines.append("};")
        lines.append(f"bool encode_{m['name']}(Writer& w, const {m['name']}& v);")
        lines.append(f"bool decode_{m['name']}(Reader& r, {m['name']}& v);")
        lines.append("")

    lines.append("// --- implementations ---")
    lines.append("")

    def emit_encode_field(fname: str, ft: dict, prefix: str = "v.") -> list[str]:
        out: list[str] = []
        k = ft["kind"]
        src = f"{prefix}{fname}"
        if k == "u8":
            out.append(f"  if (!w.u8({src})) return false;")
        elif k == "u16":
            out.append(f"  if (!w.u16({src})) return false;")
        elif k == "u32":
            out.append(f"  if (!w.u32({src})) return false;")
        elif k == "u64":
            out.append(f"  if (!w.u64({src})) return false;")
        elif k == "i32":
            out.append(f"  if (!w.i32({src})) return false;")
        elif k == "bool":
            out.append(f"  if (!w.boolean({src})) return false;")
        elif k == "str":
            out.append(f"  if (!w.str({src})) return false;")
        elif k == "bytes":
            out.append(f"  if (!w.bytes({src})) return false;")
        elif k == "enum":
            width = next(e["width"] for e in data["enum"] if e["name"] == ft["name"])
            cast = {"u8": "uint8_t", "u16": "uint16_t", "u32": "uint32_t"}[width]
            meth = {"u8": "u8", "u16": "u16", "u32": "u32"}[width]
            out.append(f"  if (!w.{meth}(static_cast<{cast}>({src}))) return false;")
        elif k == "struct":
            out.append(f"  if (!encode_{ft['name']}(w, {src})) return false;")
        elif k == "list":
            out.append(f"  if ({prefix}{fname}_count > {ft['max']}) return false;")
            out.append(f"  if (!w.u8({prefix}{fname}_count)) return false;")
            out.append(f"  for (uint8_t i = 0; i < {prefix}{fname}_count; ++i) {{")
            inner_lines = emit_encode_field(f"{fname}[i]", ft["inner"], prefix)
            for il in inner_lines:
                out.append("  " + il)
            out.append("  }")
        return out

    def emit_decode_field(fname: str, ft: dict, prefix: str = "v.") -> list[str]:
        out: list[str] = []
        k = ft["kind"]
        dst = f"{prefix}{fname}"
        if k == "u8":
            out.append(f"  if (!r.u8({dst})) return false;")
        elif k == "u16":
            out.append(f"  if (!r.u16({dst})) return false;")
        elif k == "u32":
            out.append(f"  if (!r.u32({dst})) return false;")
        elif k == "u64":
            out.append(f"  if (!r.u64({dst})) return false;")
        elif k == "i32":
            out.append(f"  if (!r.i32({dst})) return false;")
        elif k == "bool":
            out.append(f"  if (!r.boolean({dst})) return false;")
        elif k == "str":
            out.append(f"  if (!r.str({dst})) return false;")
        elif k == "bytes":
            out.append(f"  if (!r.bytes({dst})) return false;")
        elif k == "enum":
            width = next(e["width"] for e in data["enum"] if e["name"] == ft["name"])
            tmp = {"u8": "uint8_t", "u16": "uint16_t", "u32": "uint32_t"}[width]
            meth = {"u8": "u8", "u16": "u16", "u32": "u32"}[width]
            out.append(f"  {tmp} _e_{fname}{{}};")
            out.append(f"  if (!r.{meth}(_e_{fname})) return false;")
            out.append(f"  {dst} = static_cast<{ft['name']}>(_e_{fname});")
        elif k == "struct":
            out.append(f"  if (!decode_{ft['name']}(r, {dst})) return false;")
        elif k == "list":
            out.append(f"  if (!r.u8({prefix}{fname}_count)) return false;")
            out.append(f"  if ({prefix}{fname}_count > {ft['max']}) return false;")
            out.append(f"  for (uint8_t i = 0; i < {prefix}{fname}_count; ++i) {{")
            for il in emit_decode_field(f"{fname}[i]", ft["inner"], prefix):
                out.append("  " + il)
            out.append("  }")
        return out

    for s in data.get("struct", []):
        lines.append(f"inline bool encode_{s['name']}(Writer& w, const {s['name']}& v) {{")
        for f in s.get("fields", []):
            lines.extend(emit_encode_field(f["name"], field_type(f)))
        lines.append("  return w.ok();")
        lines.append("}")
        lines.append(f"inline bool decode_{s['name']}(Reader& r, {s['name']}& v) {{")
        for f in s.get("fields", []):
            lines.extend(emit_decode_field(f["name"], field_type(f)))
        lines.append("  return r.ok();")
        lines.append("}")
        lines.append("")

    for m in data.get("message", []):
        lines.append(f"inline bool encode_{m['name']}(Writer& w, const {m['name']}& v) {{")
        for f in m.get("fields", []):
            lines.extend(emit_encode_field(f["name"], field_type(f)))
        lines.append("  return w.ok();")
        lines.append("}")
        lines.append(f"inline bool decode_{m['name']}(Reader& r, {m['name']}& v) {{")
        for f in m.get("fields", []):
            lines.extend(emit_decode_field(f["name"], field_type(f)))
        lines.append("  return r.ok();")
        lines.append("}")
        lines.append("")

    # opcode → name table for tests
    lines.append("inline const char* opcodeName(uint16_t op) {")
    lines.append("  switch (op) {")
    for m in data.get("message", []):
        lines.append(f'    case 0x{int(m["opcode"]):04X}: return "{m["name"]}";')
    lines.append('    default: return nullptr;')
    lines.append("  }")
    lines.append("}")
    lines.append("")
    lines.append("}  // namespace speculum::wire")
    lines.append("")
    return "\n".join(lines)


def emit_ts(data: dict, h: str) -> str:
    lines = [
        "// GENERATED by wiregen — DO NOT EDIT",
        f"// schema_sha256={h}",
        f'export const SCHEMA_SHA256 = "{h}";',
        f"export const MESSAGE_COUNT = {len(data.get('message', []))};",
        "",
        "export class CursorReader {",
        "  private view: DataView;",
        "  private o = 0;",
        "  private _ok = true;",
        "  constructor(buf: ArrayBuffer | Uint8Array) {",
        "    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);",
        "    this.view = new DataView(u.buffer, u.byteOffset, u.byteLength);",
        "  }",
        "  ok() { return this._ok; }",
        "  private need(n: number) { if (this.o + n > this.view.byteLength) this._ok = false; return this._ok; }",
        "  u8() { if (!this.need(1)) return 0; const v = this.view.getUint8(this.o); this.o += 1; return v; }",
        "  u16() { if (!this.need(2)) return 0; const v = this.view.getUint16(this.o, true); this.o += 2; return v; }",
        "  u32() { if (!this.need(4)) return 0; const v = this.view.getUint32(this.o, true); this.o += 4; return v; }",
        "  u64() { if (!this.need(8)) return 0n; const lo = this.view.getUint32(this.o, true); const hi = this.view.getUint32(this.o+4, true); this.o += 8; return BigInt(lo) + (BigInt(hi) << 32n); }",
        "  i32() { if (!this.need(4)) return 0; const v = this.view.getInt32(this.o, true); this.o += 4; return v; }",
        "  bool() { return this.u8() !== 0; }",
        "  str() { const n = this.u32(); if (!this._ok || !this.need(n)) return ''; const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.o, n); this.o += n; return new TextDecoder().decode(bytes); }",
        "  bytes() { const n = this.u32(); if (!this._ok || !this.need(n)) return new Uint8Array(); const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.o, n); this.o += n; return bytes.slice(); }",
        "}",
        "",
        "export class CursorWriter {",
        "  private parts: number[] = [];",
        "  private _ok = true;",
        "  ok() { return this._ok; }",
        "  u8(v: number) { this.parts.push(v & 0xff); }",
        "  u16(v: number) { this.parts.push(v & 0xff, (v >>> 8) & 0xff); }",
        "  u32(v: number) { this.parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }",
        "  u64(v: bigint) { const lo = Number(v & 0xffffffffn); const hi = Number((v >> 32n) & 0xffffffffn); this.u32(lo); this.u32(hi); }",
        "  i32(v: number) { this.u32(v >>> 0); }",
        "  bool(v: boolean) { this.u8(v ? 1 : 0); }",
        "  str(v: string) { const b = new TextEncoder().encode(v); this.u32(b.length); for (const x of b) this.parts.push(x); }",
        "  bytes(v: Uint8Array) { this.u32(v.length); for (const x of v) this.parts.push(x); }",
        "  toUint8Array() { return Uint8Array.from(this.parts); }",
        "}",
        "",
    ]
    for e in data.get("enum", []):
        lines.append(f"export enum {e['name']} {{")
        for v in e["values"]:
            lines.append(f"  {v['name']} = {v['number']},")
        lines.append("}")
        lines.append("")

    # structs + messages as interfaces + encode/decode functions
    for s in data.get("struct", []):
        lines.append(f"export interface {s['name']} {{")
        for f in s.get("fields", []):
            ft = field_type(f)
            lines.append(f"  {f['name']}: {_ts_type(ft)};")
        lines.append("}")
        lines.append("")

    for m in data.get("message", []):
        lines.append(f"export const OPC_{m['name']} = 0x{int(m['opcode']):04X};")
        lines.append(f"export interface {m['name']} {{")
        for f in m.get("fields", []):
            ft = field_type(f)
            lines.append(f"  {f['name']}: {_ts_type(ft)};")
        lines.append("}")
        lines.append("")

    # encode/decode helpers generated similarly — use a compact approach
    lines.append(emit_ts_codecs(data))
    lines.append("")
    lines.append("export const MESSAGE_NAMES: Record<number, string> = {")
    for m in data.get("message", []):
        lines.append(f'  0x{int(m["opcode"]):04X}: "{m["name"]}",')
    lines.append("};")
    lines.append("")
    return "\n".join(lines)


def _ts_type(ft: dict) -> str:
    k = ft["kind"]
    if k in ("u8", "u16", "u32", "i32"):
        return "number"
    if k == "u64":
        return "bigint"
    if k == "bool":
        return "boolean"
    if k == "str":
        return "string"
    if k == "bytes":
        return "Uint8Array"
    if k == "enum":
        return ft["name"]
    if k == "struct":
        return ft["name"]
    if k == "list":
        return f"{_ts_type(ft['inner'])}[]"
    raise RuntimeError(ft)


def emit_ts_codecs(data: dict) -> str:
    parts: list[str] = []

    def enc_expr(ft: dict, expr: str) -> str:
        k = ft["kind"]
        if k == "u8":
            return f"w.u8({expr})"
        if k == "u16":
            return f"w.u16({expr})"
        if k == "u32":
            return f"w.u32({expr})"
        if k == "u64":
            return f"w.u64({expr})"
        if k == "i32":
            return f"w.i32({expr})"
        if k == "bool":
            return f"w.bool({expr})"
        if k == "str":
            return f"w.str({expr})"
        if k == "bytes":
            return f"w.bytes({expr})"
        if k == "enum":
            width = next(e["width"] for e in data["enum"] if e["name"] == ft["name"])
            meth = {"u8": "u8", "u16": "u16", "u32": "u32"}[width]
            return f"w.{meth}({expr})"
        if k == "struct":
            return f"encode{ft['name']}(w, {expr})"
        if k == "list":
            return (
                f"{{ w.u8({expr}.length); for (const _it of {expr}) {{ {enc_expr(ft['inner'], '_it')}; }} }}"
            )
        raise RuntimeError(ft)

    def dec_expr(ft: dict) -> str:
        k = ft["kind"]
        if k == "u8":
            return "r.u8()"
        if k == "u16":
            return "r.u16()"
        if k == "u32":
            return "r.u32()"
        if k == "u64":
            return "r.u64()"
        if k == "i32":
            return "r.i32()"
        if k == "bool":
            return "r.bool()"
        if k == "str":
            return "r.str()"
        if k == "bytes":
            return "r.bytes()"
        if k == "enum":
            width = next(e["width"] for e in data["enum"] if e["name"] == ft["name"])
            meth = {"u8": "u8", "u16": "u16", "u32": "u32"}[width]
            return f"r.{meth}() as {ft['name']}"
        if k == "struct":
            return f"decode{ft['name']}(r)"
        if k == "list":
            return (
                f"(() => {{ const n = r.u8(); const a: {_ts_type(ft['inner'])}[] = []; "
                f"for (let i = 0; i < n; i++) a.push({dec_expr(ft['inner'])}); return a; }})()"
            )
        raise RuntimeError(ft)

    for s in data.get("struct", []):
        parts.append(f"export function encode{s['name']}(w: CursorWriter, v: {s['name']}) {{")
        for f in s.get("fields", []):
            fname = f["name"]
            parts.append(f"  {enc_expr(field_type(f), 'v.' + fname)};")
        parts.append("}")
        parts.append(f"export function decode{s['name']}(r: CursorReader): {s['name']} {{")
        parts.append("  return {")
        for f in s.get("fields", []):
            parts.append(f"    {f['name']}: {dec_expr(field_type(f))},")
        parts.append("  };")
        parts.append("}")

    for m in data.get("message", []):
        parts.append(f"export function encode{m['name']}(w: CursorWriter, v: {m['name']}) {{")
        for f in m.get("fields", []):
            fname = f["name"]
            parts.append(f"  {enc_expr(field_type(f), 'v.' + fname)};")
        parts.append("}")
        parts.append(f"export function decode{m['name']}(r: CursorReader): {m['name']} {{")
        if not m.get("fields"):
            parts.append("  return {};")
        else:
            parts.append("  return {")
            for f in m.get("fields", []):
                parts.append(f"    {f['name']}: {dec_expr(field_type(f))},")
            parts.append("  };")
        parts.append("}")
        parts.append(
            f"export function encode{m['name']}Bytes(v: {m['name']}): Uint8Array {{ const w = new CursorWriter(); encode{m['name']}(w, v); return w.toUint8Array(); }}"
        )
        parts.append(
            f"export function decode{m['name']}Bytes(b: Uint8Array): {m['name']} {{ const r = new CursorReader(b); const v = decode{m['name']}(r); if (!r.ok()) throw new Error('decode {m['name']}'); return v; }}"
        )
    return "\n".join(parts)


def emit_cs(data: dict, h: str) -> str:
    lines = [
        "// GENERATED by wiregen — DO NOT EDIT",
        f"// schema_sha256={h}",
        "using System;",
        "using System.Buffers.Binary;",
        "using System.Text;",
        "",
        "namespace Speculum.Wire;",
        "",
        f'public static class SchemaMeta {{ public const string Sha256 = "{h}"; public const int MessageCount = {len(data.get("message", []))}; }}',
        "",
        "public ref struct CursorReader {",
        "  ReadOnlySpan<byte> _b; int _o; public bool Ok { get; private set; } = true;",
        "  public CursorReader(ReadOnlySpan<byte> b) { _b = b; _o = 0; }",
        "  bool Need(int n) { if (_o + n > _b.Length) { Ok = false; return false; } return true; }",
        "  public byte U8() { if (!Need(1)) return 0; var v = _b[_o]; _o += 1; return v; }",
        "  public ushort U16() { if (!Need(2)) return 0; var v = BinaryPrimitives.ReadUInt16LittleEndian(_b.Slice(_o)); _o += 2; return v; }",
        "  public uint U32() { if (!Need(4)) return 0; var v = BinaryPrimitives.ReadUInt32LittleEndian(_b.Slice(_o)); _o += 4; return v; }",
        "  public ulong U64() { if (!Need(8)) return 0; var v = BinaryPrimitives.ReadUInt64LittleEndian(_b.Slice(_o)); _o += 8; return v; }",
        "  public int I32() { if (!Need(4)) return 0; var v = BinaryPrimitives.ReadInt32LittleEndian(_b.Slice(_o)); _o += 4; return v; }",
        "  public bool Bool() => U8() != 0;",
        "  public string Str() { var n = (int)U32(); if (!Ok || !Need(n)) return \"\"; var s = Encoding.UTF8.GetString(_b.Slice(_o, n)); _o += n; return s; }",
        "  public byte[] Bytes() { var n = (int)U32(); if (!Ok || !Need(n)) return Array.Empty<byte>(); var a = _b.Slice(_o, n).ToArray(); _o += n; return a; }",
        "}",
        "",
        "public class CursorWriter {",
        "  readonly System.Collections.Generic.List<byte> _p = new();",
        "  public bool Ok => true;",
        "  public void U8(byte v) => _p.Add(v);",
        "  public void U16(ushort v) { Span<byte> t = stackalloc byte[2]; BinaryPrimitives.WriteUInt16LittleEndian(t, v); _p.Add(t[0]); _p.Add(t[1]); }",
        "  public void U32(uint v) { Span<byte> t = stackalloc byte[4]; BinaryPrimitives.WriteUInt32LittleEndian(t, v); for (int i=0;i<4;i++) _p.Add(t[i]); }",
        "  public void U64(ulong v) { Span<byte> t = stackalloc byte[8]; BinaryPrimitives.WriteUInt64LittleEndian(t, v); for (int i=0;i<8;i++) _p.Add(t[i]); }",
        "  public void I32(int v) => U32(unchecked((uint)v));",
        "  public void Bool(bool v) => U8(v ? (byte)1 : (byte)0);",
        "  public void Str(string v) { var b = Encoding.UTF8.GetBytes(v); U32((uint)b.Length); _p.AddRange(b); }",
        "  public void Bytes(ReadOnlySpan<byte> v) { U32((uint)v.Length); for (int i=0;i<v.Length;i++) _p.Add(v[i]); }",
        "  public byte[] ToArray() => _p.ToArray();",
        "}",
        "",
    ]
    for e in data.get("enum", []):
        w = {"u8": "byte", "u16": "ushort", "u32": "uint"}[e["width"]]
        lines.append(f"public enum {e['name']} : {w} {{")
        for v in e["values"]:
            lines.append(f"  {v['name']} = {v['number']},")
        lines.append("}")
        lines.append("")

    for s in data.get("struct", []):
        lines.append(f"public struct {s['name']} {{")
        for f in s.get("fields", []):
            lines.append(f"  public {_cs_type(field_type(f))} {f['name']};")
        lines.append("}")
        lines.append("")

    for m in data.get("message", []):
        lines.append(f"public static class Op{m['name']} {{ public const ushort Code = 0x{int(m['opcode']):04X}; }}")
        lines.append(f"public struct {m['name']} {{")
        for f in m.get("fields", []):
            lines.append(f"  public {_cs_type(field_type(f))} {f['name']};")
        lines.append("}")
        lines.append("")

    lines.append(emit_cs_codecs(data))
    return "\n".join(lines)


def _cs_type(ft: dict) -> str:
    k = ft["kind"]
    if k == "u8":
        return "byte"
    if k == "u16":
        return "ushort"
    if k == "u32":
        return "uint"
    if k == "u64":
        return "ulong"
    if k == "i32":
        return "int"
    if k == "bool":
        return "bool"
    if k == "str":
        return "string"
    if k == "bytes":
        return "byte[]"
    if k == "enum":
        return ft["name"]
    if k == "struct":
        return ft["name"]
    if k == "list":
        return f"{_cs_type(ft['inner'])}[]"
    raise RuntimeError(ft)


def emit_cs_codecs(data: dict) -> str:
    parts: list[str] = ["public static class Codecs {"]

    def enc(ft: dict, expr: str) -> str:
        k = ft["kind"]
        if k == "u8":
            return f"w.U8({expr});"
        if k == "u16":
            return f"w.U16({expr});"
        if k == "u32":
            return f"w.U32({expr});"
        if k == "u64":
            return f"w.U64({expr});"
        if k == "i32":
            return f"w.I32({expr});"
        if k == "bool":
            return f"w.Bool({expr});"
        if k == "str":
            return f"w.Str({expr});"
        if k == "bytes":
            return f"w.Bytes({expr});"
        if k == "enum":
            width = next(e["width"] for e in data["enum"] if e["name"] == ft["name"])
            cast = {"u8": "byte", "u16": "ushort", "u32": "uint"}[width]
            meth = {"u8": "U8", "u16": "U16", "u32": "U32"}[width]
            return f"w.{meth}(({cast}){expr});"
        if k == "struct":
            return f"Encode{ft['name']}(w, {expr});"
        if k == "list":
            return (
                f"w.U8((byte){expr}.Length); foreach (var _it in {expr}) {{ {enc(ft['inner'], '_it')} }}"
            )
        raise RuntimeError(ft)

    def dec(ft: dict, dest: str) -> str:
        k = ft["kind"]
        if k == "u8":
            return f"{dest} = r.U8();"
        if k == "u16":
            return f"{dest} = r.U16();"
        if k == "u32":
            return f"{dest} = r.U32();"
        if k == "u64":
            return f"{dest} = r.U64();"
        if k == "i32":
            return f"{dest} = r.I32();"
        if k == "bool":
            return f"{dest} = r.Bool();"
        if k == "str":
            return f"{dest} = r.Str();"
        if k == "bytes":
            return f"{dest} = r.Bytes();"
        if k == "enum":
            width = next(e["width"] for e in data["enum"] if e["name"] == ft["name"])
            meth = {"u8": "U8", "u16": "U16", "u32": "U32"}[width]
            return f"{dest} = ({ft['name']})r.{meth}();"
        if k == "struct":
            return f"{dest} = Decode{ft['name']}(ref r);"
        if k == "list":
            return (
                f"{{ var n = r.U8(); {dest} = new {_cs_type(ft['inner'])}[n]; "
                f"for (int i=0;i<n;i++) {{ {dec(ft['inner'], dest + '[i]')} }} }}"
            )
        raise RuntimeError(ft)

    for s in data.get("struct", []):
        parts.append(f"  public static void Encode{s['name']}(CursorWriter w, {s['name']} v) {{")
        for f in s.get("fields", []):
            fname = f["name"]
            parts.append(f"    {enc(field_type(f), 'v.' + fname)}")
        parts.append("  }")
        parts.append(f"  public static {s['name']} Decode{s['name']}(ref CursorReader r) {{")
        parts.append(f"    var v = new {s['name']}();")
        for f in s.get("fields", []):
            fname = f["name"]
            parts.append(f"    {dec(field_type(f), 'v.' + fname)}")
        parts.append("    return v;")
        parts.append("  }")

    for m in data.get("message", []):
        parts.append(f"  public static void Encode{m['name']}(CursorWriter w, {m['name']} v) {{")
        for f in m.get("fields", []):
            fname = f["name"]
            parts.append(f"    {enc(field_type(f), 'v.' + fname)}")
        parts.append("  }")
        parts.append(f"  public static {m['name']} Decode{m['name']}(ref CursorReader r) {{")
        parts.append(f"    var v = new {m['name']}();")
        for f in m.get("fields", []):
            ft = field_type(f)
            fname = f["name"]
            if ft["kind"] in ("str", "bytes", "list"):
                if ft["kind"] == "str":
                    parts.append(f'    v.{fname} = "";')
                elif ft["kind"] == "bytes":
                    parts.append(f"    v.{fname} = Array.Empty<byte>();")
                else:
                    parts.append(
                        f"    v.{fname} = Array.Empty<{_cs_type(ft['inner'])}>();"
                    )
            parts.append(f"    {dec(ft, 'v.' + fname)}")
        parts.append(
            '    if (!r.Ok) throw new InvalidOperationException("decode ' + m["name"] + '");'
        )
        parts.append("    return v;")
        parts.append("  }")
        parts.append(
            f"  public static byte[] Encode{m['name']}Bytes({m['name']} v) {{ var w = new CursorWriter(); Encode{m['name']}(w, v); return w.ToArray(); }}"
        )
        parts.append(
            f"  public static {m['name']} Decode{m['name']}Bytes(ReadOnlySpan<byte> b) {{ var r = new CursorReader(b); return Decode{m['name']}(ref r); }}"
        )

    parts.append("}")
    return "\n".join(parts)


def generate(schema_path: Path) -> str:
    data = load_schema(schema_path)
    validate(data)
    h = schema_hash(schema_path)
    OUT_CPP.mkdir(parents=True, exist_ok=True)
    OUT_TS.mkdir(parents=True, exist_ok=True)
    OUT_CS.mkdir(parents=True, exist_ok=True)
    _atomic_write(OUT_CPP / "SpeculumWire.gen.hpp", emit_cpp(data, h))
    _atomic_write(OUT_TS / "speculum_wire.gen.ts", emit_ts(data, h))
    _atomic_write(OUT_CS / "SpeculumWire.gen.cs", emit_cs(data, h))
    _atomic_write(OUT_CPP / "schema.sha256", h + "\n")
    return h


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    ap.add_argument("--check", action="store_true", help="validate only")
    ap.add_argument("--refuse-test", type=Path, help="expect schema to fail; print rule")
    args = ap.parse_args()
    if args.refuse_test:
        try:
            data = load_schema(args.refuse_test)
            validate(data)
            print("EXPECTED_REFUSE_BUT_PASSED", file=sys.stderr)
            return 2
        except SchemaError as e:
            print(f"refuse#{e.rule}: {e}")
            return 0
        except Exception as e:
            print(f"refuse#?: {e}", file=sys.stderr)
            return 1
    try:
        if args.check:
            validate(load_schema(args.schema))
            print("ok", schema_hash(args.schema))
            return 0
        h = generate(args.schema)
        print(f"generated schema_sha256={h} messages={len(load_schema(args.schema).get('message', []))}")
        return 0
    except SchemaError as e:
        print(str(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

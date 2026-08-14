# Implementation — Encode (binary writer)

| Field | Value |
|-------|-------|
| **Future path** | `Refactor/sidecar/browser/patchright/mirror/page/encode.ts` **and** in-page fragment `inpage/encode.frag.ts` |
| **LOC ceiling** | 300 |
| **Contracts implemented** | [04-wire.md](../../contracts/04-wire.md); redesign §5.4–5.5; D-SPEC-1 opcode 12; D-SPEC-2 produce-once in-page |
| **Invariants** | Little-endian. Magic `0x5050`, version `1`. Per-part string table dedup. Write into preallocated reusable `ArrayBuffer`/`Uint8Array`. Part split when exceeding `maxFrameBytes` without splitting sequence. No JSON on this path. |
| **Ban list** | `JSON.stringify` / `JSON.parse` of frame/establish payloads. Intermediate full-document JS object trees. Unknown best-effort versioning. Per-envelope `plane` field. T6 `document` node-tree op. |

---

## Types / signatures

```ts
const FRAME_MAGIC = 0x5050;
const FRAME_VERSION = 1;
const FLAG_ESTABLISH = 1 << 0;
const FLAG_RESYNC = 1 << 1;

const OP = {
  establishBegin: 1,
  establishChunk: 2,
  establishEnd: 3,
  childList: 4,
  patch: 5,
  scrollViewport: 6,
  scrollElement: 7,
  cssomInstall: 8,
  cssomSheetList: 9,
  cssomRuleList: 10,
  cssomPatch: 11,
  documentState: 12,
} as const;

interface EncodeInput {
  generation: number;
  sequence: number;
  flags: number;
  ops: WireOp[];
  maxFrameBytes: number; // default 1048576
}

interface EncodedPart {
  partIndex: number;
  partCount: number;
  bytes: Uint8Array; // transfer-ready slice
}

interface FrameEncoder {
  /** Reset reusable buffer capacity if needed; encode ops into one or more parts. */
  encode(input: EncodeInput): EncodedPart[];
}
```

---

## Buffer strategy

1. Maintain a reusable `ArrayBuffer` (≥ `maxFrameBytes` + slack) and a scratch string→index `Map`.
2. On encode: clear map; write header placeholders; write strings+ops; if size > `maxFrameBytes`, repartition ops into multiple parts (see split).
3. Never allocate a new buffer per op; grow geometrically only when a single part cannot fit one op (then that op’s part may exceed soft target only if a single op is larger than max — still emit one part containing that op; MUST NOT drop). If a single op > `maxFrameBytes`, emit it as its own part (oversize exception) and still share generation/sequence — client accepts; telemetry may note. Prefer splitting string-heavy ops earlier (establishChunk already chunked).

---

## Step-by-step — single part layout

Write sequentially LE:

| Field | Size | Value |
|-------|------|-------|
| magic | u16 | `0x5050` |
| version | u8 | `1` |
| flags | u8 | establish/resync bits |
| generation | u32 | |
| sequence | u32 | |
| partIndex | u16 | |
| partCount | u16 | |
| strCount | u32 | |
| strings | repeated | `[len u32][utf8 bytes]` |
| opCount | u32 | |
| ops | repeated | `[opCode u8][payload]` |

### String intern

`intern(s: string): u32` — if in map return index; else append UTF-8 bytes with length prefix; map set; return new index. Indices are 0-based within the part.

### Node encoding (preorder)

```
kind u8: ELEMENT=1 | TEXT=2 | COMMENT=3
ELEMENT: id u32, tag strIdx u32, attrCount u16,
         (nameIdx u32, valueIdx u32)*attrCount,
         childCount u32, Node*childCount
TEXT/COMMENT: id u32, value strIdx u32
```

### Op payloads

**establishBegin (1)**  
`generation` already in header; payload: `viewportW u32, viewportH u32, scrollX f64, scrollY f64, scrollElCount u32`, then each `{ id u32, top f64, left f64 }`.  
(Use f64 for scroll positions.)

**establishChunk (2)**  
`byteLen u32`, then raw UTF-8 HTML bytes (not via string table — large).

**establishEnd (3)**  
`nodeCount u32`, `checksum u32`.

**childList (4)**  
`parent u32`, `mode u8`, `childCount u32`, then each ChildRef:  
- existing: `kind=0 u8`, `id u32`  
- fresh: `kind=1 u8`, then Node encoding (may include children)

**patch (5)**  
`node u32`, then Node encoding with `childCount=0` for elements (or TEXT/COMMENT form).

**scrollViewport (6)**  
`scrollX f64`, `scrollY f64`.

**scrollElement (7)**  
`node u32`, `scrollTop f64`, `scrollLeft f64`.

**cssomInstall (8)**  
`sheetCount u32`, then each sheet record (see [cssom.md](cssom.md) binary sheet shape): ids in Cssom range.

**cssomSheetList (9)**  
`removedCount u32`, `removed id u32`*; `addedCount u32`, then `{ index u32, sheet }`*.

**cssomRuleList (10)**  
`sheet u32`, `removedCount`/`ids`, `addedCount`/`{index, rule}`*.

**cssomPatch (11)**  
`ruleId u32`, then rule record.

**documentState (12)**  
`titleIdx u32`, `langIdx u32`, `dirIdx u32`, `viewportContentIdx u32` (all via string table).

Unknown opcode at decode ⇒ desync; encoder MUST only emit 1–12.

---

## Part splitting algorithm

1. Encode all ops into a logical stream with a shared string table **attempt** for one part.
2. If `byteLength <= maxFrameBytes` → one part (`partCount=1`).
3. Else split **op list** into contiguous segments where each segment encodes to ≤ max (establishChunk already sized). Re-intern strings **per part** (tables are per-part).
4. All parts share `generation`, `sequence`, `flags`; `partIndex = 0..n-1`; `partCount = n`.
5. Client applies only when all parts assembled; missing ⇒ desync (PP-FR-8).

---

## Ordering before encode

Caller MUST pass ops already ordered per contract 04. Encoder does not reorder.

---

## PP-* tests

| ID | Assert |
|----|--------|
| `PP-WIRE-1` | API never parses body (encoder produces opaque bytes) |
| `PP-WIRE-2` | version≠1 rejected by client |
| `PP-WIRE-3` | No JSON on encode path |
| `PP-FR-8` | Split parts; missing part desyncs; one transaction |
| `PP-EST-7` | establishEnd checksum fields encoded as u32 |

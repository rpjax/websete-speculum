# Implementation — `decode.ts` (web)

**Future path:** `web/src/features/sessions/live/page/decode.ts`  
**LOC ceiling:** 300  
**Contracts:** [04-wire.md](../../contracts/04-wire.md), [07-recovery.md](../../contracts/07-recovery.md), [16-errors.md](../../contracts/16-errors.md)  
**Decisions:** D-SPEC-1 (`documentState=12`), D-SPEC-5 (`scrollViewport`), D-SPEC-8 (Cssom id range — decode accepts any u32; apply validates range)  
**Norm:** redesign §5.5  
**Companion:** `opcodes.ts` ≤ 100 LOC (shared constants; MAY live beside this file)

---

## Purpose

Binary reader for PageProjection frame parts. Assembles multi-part frames. Emits typed ops for apply. **Unknown `version` or any decode error ⇒ desync** — never best-effort parse (PP-WIRE-2).

---

## Invariants

1. Little-endian throughout.
2. Magic MUST be `0x5050` (`'PP'`). Mismatch ⇒ `wire_decode_error`.
3. `version === 1` only for this pack; any other ⇒ `wire_version_unknown` desync.
4. Parts sharing `(generation, sequence)` assemble by `partIndex`; apply only when all `partCount` parts present.
5. Missing part (gap in `partIndex`, or timeout owned by orchestrator) ⇒ `part_missing` desync.
6. String table is **per part**; ops in that part index strings from **that** part’s table only. Assembly concatenates **ops** across parts in `partIndex` order; string indices are resolved **during** per-part decode into UTF-8 strings owned by the assembled op payloads (never leave dangling strIdx across parts).
7. No `JSON.parse` on this path (PP-WIRE-3).

---

## Bans

- Best-effort skip of unknown opcodes (unknown opcode ⇒ desync).
- Applying a single part as a frame when `partCount > 1`.
- Sharing string-table indices across parts without materializing strings at decode time.
- Allocating large intermediate object trees beyond the typed op list.
- Treating compression as part of the format (transport MAY decompress before this reader).

---

## Opcode constants (`opcodes.ts`)

```ts
export const PP_MAGIC = 0x5050;
export const PP_VERSION = 1;

export const Op = {
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

export const ChildListMode = { FULL: 0, APPEND: 1 } as const;
export const NodeKind = { ELEMENT: 1, TEXT: 2, COMMENT: 3 } as const;
export const ChildRefKind = { existing: 0, fresh: 1 } as const;

export const FLAG_ESTABLISH = 1 << 0;
export const FLAG_RESYNC = 1 << 1;
```

---

## Types and signatures

```ts
export type FrameHeader = {
  version: number;
  flags: number;
  generation: number;
  sequence: number;
  partIndex: number;
  partCount: number;
};

export type ChildRef =
  | { kind: 'existing'; id: number }
  | { kind: 'fresh'; node: DecodedNode };

export type DecodedNode =
  | {
      kind: 'element';
      id: number;
      tag: string;
      attrs: Array<{ name: string; value: string }>;
      children: DecodedNode[];
    }
  | { kind: 'text'; id: number; value: string }
  | { kind: 'comment'; id: number; value: string };

export type WireOp =
  | { op: 'establishBegin'; generation: number; viewport: { w: number; h: number };
      scrollViewport: { x: number; y: number };
      scrollElements: Array<{ id: number; top: number; left: number }> }
  | { op: 'establishChunk'; bytes: Uint8Array } // UTF-8 HTML
  | { op: 'establishEnd'; nodeCount: number; checksum: number }
  | { op: 'childList'; parent: number; mode: 0 | 1; children: ChildRef[] }
  | { op: 'patch'; node: number; snapshot: PatchSnapshot }
  | { op: 'scrollViewport'; scrollX: number; scrollY: number }
  | { op: 'scrollElement'; node: number; scrollTop: number; scrollLeft: number }
  | { op: 'documentState'; title: string; lang: string; dir: string; viewportContent: string }
  | { op: 'cssomInstall'; sheets: CssomSheetInstall[] }
  | { op: 'cssomSheetList'; removed: number[]; added: Array<{ index: number; sheet: CssomSheetInstall }> }
  | { op: 'cssomRuleList'; sheet: number; removed: number[]; added: Array<{ index: number; rule: CssomRule }> }
  | { op: 'cssomPatch'; rule: number; rulePayload: CssomRule };

export type PatchSnapshot =
  | { kind: 'element'; tag: string; attrs: Array<{ name: string; value: string }> /* includes §5.2.1 state attrs */ }
  | { kind: 'text'; value: string }
  | { kind: 'comment'; value: string };

export type CssomScope = 'main' | 'pierceHost';
export type CssomSheetInstall = { id: number; scope: CssomScope; pierceHostId?: number; /* rules payload per cssom contract */ };
export type CssomRule = { id: number; cssText: string; /* type fields as sealed cssom */ };

export type AssembledFrame = {
  header: FrameHeader;
  ops: WireOp[];
};

export type DecodeErrorCode =
  | 'wire_version_unknown'
  | 'wire_decode_error'
  | 'part_missing';

export class DecodeError extends Error {
  constructor(
    readonly errorCode: DecodeErrorCode,
    readonly phase: 'live_apply' | 'establish' | 'resync',
    message: string,
  ) { super(message); }
}

/** Decode one part body (full frame bytes including header). Throws DecodeError. */
export function decodePart(bytes: Uint8Array, phase: DecodeError['phase']): { header: FrameHeader; ops: WireOp[] };

export interface PartAssembler {
  /** Push a decoded part; returns AssembledFrame when complete, else null. */
  push(part: { header: FrameHeader; ops: WireOp[] }): AssembledFrame | null;
  /** Drop incomplete assembly (on desync / generation bump). */
  reset(): void;
}
```

Payload field widths for Cssom sheets/rules beyond `id`/`scope`/`cssText` are defined by sealed cssom + [06-cssom.md](../../contracts/06-cssom.md); decode MUST read the exact binary layout frozen in `implementation/sidecar/encode.md`. This file specifies **reader structure and failure policy**; bit layout of nested Cssom payloads MUST match encode 1:1.

---

## Algorithm — binary layout read

```
offset 0:
  magic      u16  == 0x5050 else wire_decode_error
  version    u8   == 1 else wire_version_unknown
  flags      u8
  generation u32
  sequence   u32
  partIndex  u16
  partCount  u16  (>= 1; partIndex < partCount else wire_decode_error
  strCount   u32
  for i in 0..strCount:
    len u32; bytes[len] UTF-8 → strings[i]
  opCount    u32
  for i in 0..opCount:
    opCode u8
    payload per opCode (below)
  must consume exactly bytes.length (trailing junk ⇒ wire_decode_error)
```

### Payload readers (after opCode)

| Op | Fields |
|----|--------|
| `establishBegin` | `generation u32`, `vw u32`, `vh u32`, `scrollX f64` or `i32` — **lock with encode.md**; `scrollY`; `scrollElCount u32`; each `{ id u32, top, left }` |
| `establishChunk` | `byteLen u32`, `bytes[byteLen]` |
| `establishEnd` | `nodeCount u32`, `checksum u32` |
| `childList` | `parent u32`, `mode u8`, `childCount u32`, then ChildRef× |
| `patch` | `node u32`, then Node snapshot **without children** (kind + fields; element attrCount, no childCount / children) |
| `scrollViewport` | `scrollX`, `scrollY` |
| `scrollElement` | `node u32`, `scrollTop`, `scrollLeft` |
| `documentState` | four strings via strIdx or inline len+utf8 — **lock with encode.md** |
| `cssomInstall` | sheet count + sheets |
| `cssomSheetList` | removed count+ids; added count+{index, sheet} |
| `cssomRuleList` | `sheet u32`; removed; added |
| `cssomPatch` | `rule u32`; rule body |

### ChildRef

```
kind u8
  0 existing: id u32
  1 fresh:    Node (full preorder WITH children)
```

### Node (preorder)

```
kind u8
  ELEMENT=1: id u32, tag strIdx u32, attrCount u16,
             (nameIdx u32, valueIdx u32)×attrCount,
             childCount u32, Node×childCount
  TEXT=2 / COMMENT=3: id u32, value strIdx u32
```

Resolve every `strIdx` against **this part’s** `strings` immediately into JS strings when building `WireOp` / `DecodedNode`.

Unknown `opCode` ⇒ `wire_decode_error` (treated as decode error; contract 04: unknown opcode ⇒ desync).

---

## Algorithm — `PartAssembler`

```
key = generation + ':' + sequence
on push(part):
  if part.header.partCount === 1:
    return { header, ops: part.ops }  // still validate partIndex === 0

  bucket = map.get(key) or create slots[partCount]
  if slots[partIndex] already filled → wire_decode_error (duplicate part)
  slots[partIndex] = part.ops
  if any slot empty → return null
  ops = concat slots[0] .. slots[partCount-1] in order
  delete map key
  return { header: part.header with partIndex ignored, ops }

on generation bump / desync / reset:
  map.clear()
```

Orchestrator owns “part never arrives” watchdog → `part_missing`.

---

## Ordering note (decode does not reorder)

Decode preserves wire op order. Producer MUST already emit per contract 04 § ordering. Apply layers assume order; decode MUST NOT sort.

---

## Tests

| ID | Assert |
|----|--------|
| `PP-WIRE-2` | `version=2` → desync `wire_version_unknown`; no ops applied |
| `PP-WIRE-3` | No `JSON.parse` in decode module (static / review gate) |
| `PP-FR-8` | Multi-part frame: apply only after all parts; missing middle part → `part_missing` |
| `PP-REC-1` | Decode error is a desync trigger |
| Fixture | Round-trip vectors from sidecar `encode` golden bytes for each opcode including `documentState=12` |

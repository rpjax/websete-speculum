# Contract 04 — Wire format and opcodes

**Norm:** redesign §5.4, §5.5. **Tests:** PP-WIRE-1..3, PP-FR-8. **Impl:** `encode.md`, `decode.md`, API `relay.md`.

## Opcode space (no `plane` header — Q19)

| Code | Name | Plane | Address | Payload |
|------|------|-------|---------|---------|
| 1 | `establishBegin` | dom | — | `{ generation, viewport{w,h}, scrollViewport{x,y}, scrollElements[{id,top,left}] }` |
| 2 | `establishChunk` | dom | — | `{ bytes }` UTF-8 HTML fragment |
| 3 | `establishEnd` | dom | — | `{ nodeCount u32, checksum u32 }` |
| 4 | `childList` | dom | `parent u32` | `{ mode: FULL\|APPEND, children: ChildRef[] }` |
| 5 | `patch` | dom | `node u32` | full F snapshot, no children |
| 6 | `scrollViewport` | dom | — | `{ scrollX, scrollY }` |
| 7 | `scrollElement` | dom | `node u32` | `{ scrollTop, scrollLeft }` |
| 8 | `cssomInstall` | cssom | — | `{ sheets[] }` ids + scope |
| 9 | `cssomSheetList` | cssom | — | `{ removed[], added[{index, sheet}] }` |
| 10 | `cssomRuleList` | cssom | `sheet u32` | `{ removed[], added[{index, rule}] }` |
| 11 | `cssomPatch` | cssom | `rule u32` | `{ rule }` |
| 12 | `documentState` | dom | — | `{ title, lang, dir, viewportContent }` (D-SPEC-1) |

Unknown opcode ⇒ desync (decode error).

### ChildRef

```
existing: kind=0, id u32
fresh:    kind=1, Node (preorder self-delimiting, may include children)
```

### childList mode

`FULL=0`, `APPEND=1`.

## Frame binary layout (little-endian)

```
magic      u16  = 0x5050 ('PP')
version    u8   = 1; unknown ⇒ desync
flags      u8   bit0=establish, bit1=resync
generation u32
sequence   u32
partIndex  u16
partCount  u16
strCount   u32
strings    [len u32][utf8]*strCount   // per-part dedup
opCount    u32
ops        [opCode u8][payload]*opCount
```

### Node encoding

```
kind u8: ELEMENT=1 | TEXT=2 | COMMENT=3
ELEMENT: id u32, tag strIdx u32, attrCount u16, (nameIdx,valueIdx)*attrCount,
         childCount u32, Node*childCount
TEXT/COMMENT: id u32, value strIdx u32
```

## Part splitting

- Shared `generation`+`sequence`; differ by `partIndex`.  
- Client buffers; apply when `partIndex == partCount-1` assembled. Missing part ⇒ desync.  
- Split never creates separate sequences.

## Ordering within a frame (§5.4.3)

1. `establish*` (never mixed with live ops in same frame)  
2. `cssomInstall` before any `establishChunk`  
3. `childList` ancestor-first  
4. `patch`  
5. `documentState` (live; D-SPEC-1)  
6. `cssomSheetList` / `cssomRuleList` / `cssomPatch`  
7. `scrollElement`, then `scrollViewport`

Establish/resync frames: `cssomInstall` → `establishBegin` → `establishChunk`* → `establishEnd` (+ watermark fields out-of-band for resync — see contract 07).

## Producer / relay rules

1. Write into preallocated reusable buffer (D-SPEC-2).  
2. No JSON on frame/establish path (PP-WIRE-3).  
3. API reads header fields for routing only; **Body opaque** (PP-WIRE-1).  
4. Compression MAY wrap transport; format MUST NOT depend on it.

## Deleted

- T6 `document` op (node-tree document payload).  
- Per-envelope `plane` field.

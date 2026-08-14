# Contract 06 — Cssom plane

**Norm:** redesign §5.10 + sealed cssom C1–C9 (as amended). **Tests:** with Dom PP-EST-6, plane integrity. **Impl:** `cssom.md`, `applyCssom.md`.

## Kept seals

- Plane split Dom/Cssom; shared `sequence`/`generation`; one pipe (C1, C9).  
- Owned CSSOM on client (C6) — not URL stylesheet reload for authoritative rules.  
- Scope `main | pierceHost` (C7) — flattened tree must not leak pierced CSS.  
- Anti-flicker C3.1: install before paint of unstyled content.

## Encoding

- Binary §5.5; sheet/rule ids `uint32` in **Cssom range** (D-SPEC-8): `[0x80000001 .. 0xFFFFFFFF]`.  
- Ops: `cssomInstall`, `cssomSheetList`, `cssomRuleList`, `cssomPatch`.  
- Ride in same frame as Dom ops; share sequence.

## Coalescing within a frame

- Repeated writes to same rule → one `cssomPatch`.  
- Sheet added and removed in same frame → never sent.

## Ordering

- `cssomInstall` before any `establishChunk`.  
- Live: after Dom `patch`/`documentState`, before scrolls (contract 04).

## Sensors

Cssom mutations observed in-page (sheet list / rule list / cssText changes). Mark dirty; payload materialised only at flush.

## MUST NOT

- Redesign the Cssom plane beyond encoding/chronology/order/coalesce deltas.  
- Share Cssom across sessions (K2).

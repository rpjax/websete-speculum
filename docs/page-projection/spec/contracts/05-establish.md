# Contract 05 — Establish

**Norm:** redesign §5.6. **Tests:** PP-EST-1..7. **Impl:** `establish.md`.

## When

Runs at emitter init: session start and real top-level Document swap (T3/D4). Never on soft-nav alone. Never `framenavigated` alone.

## Wire order

1. `cssomInstall` (may be empty only if Virtual truly has zero sheets — fail-closed if Virtual styled and install empty is a product bug for later debug plans)  
2. `establishBegin` — generation, viewport CSS px, scroll viewport, scroll elements  
3. `establishChunk`* — well-formed HTML; ids as `speculum-anchor`; chunk target `establishChunkBytes` (64 KiB); boundaries parseable; head + above-the-fold first  
4. `establishEnd` — `nodeCount`, `checksum` (D-SPEC-4)

Flags: establish bit set. Sequence for establish frame: producer MAY use `sequence=0` for the establish frame itself; live sequences start at 1 after handoff drain (normative detail in impl spec). Live frames after end consume normal sequences.

## Client behaviour

1. Feed chunks into surface parser progressively (PP-EST-1).  
2. After `establishEnd`, walk once → `Map<u32,Node>` from `speculum-anchor`.  
3. Compare `nodeCount` + `checksum`; mismatch ⇒ desync (PP-EST-7).  
4. Apply begin scrolls before arming (PP-EST-4).  
5. Arm only when: establishEnd applied + registry verified + cssomInstall applied (PP-EST-5, PP-EST-6).

## Handoff (§5.6.6) — PP-EST-3

Producer MUST:

1. Open establish epoch; begin accumulating live frames **before** walk.  
2. Snapshot as of walk.  
3. After `establishEnd` on the wire, emit buffered live frames in sequence order (declarative `childList` + full `patch` safe over snapshot).  
4. No mutation window in neither snapshot nor a frame.

## Checksum (D-SPEC-4)

FNV-1a 32-bit over anchored elements in document order after the same chunked parse path as the client: for each element with `speculum-anchor`, mix id and tag name UTF-8. `nodeCount` = number of such anchored elements (elements only, matching registry element registration; text/comment ids appear in live frames / fresh nodes, and in establish HTML as anchors on text hosts if published — **normative:** establish HTML anchors **elements, text, and comment wrappers** consistently with F; checksum mixes every anchored node id + kind byte + tag-or-empty). Exact byte mix order is fixed in `implementation/sidecar/establish.md`.

## MUST NOT

- Full DomMap dump / bootstrap after stream seed.  
- Arm before cssomInstall.  
- Silent click targeting while unarmed.

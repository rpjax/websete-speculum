# Contract 16 — Errors, desync, degrade

**Norm:** redesign §5.7.1, engineering-standards failure shape, §5.3.5.

## Two classes

| Class | Effect | Examples |
|-------|--------|----------|
| **Degrade** | Rate ladder down; larger frames; session continues | congestion, host pressure, apply overrun, hidden |
| **Desync** | Disarm, buffer, OOB resync | contract 07 trigger list |

Overload is **never** desync.

## Failure fact shape

Catalogued failure MUST include:

- `errorCode` (stable string enum)  
- `phase` (stable string enum)  
- enough context to diagnose without PII  

## Suggested errorCode set (normative for this pack)

| errorCode | When |
|-----------|------|
| `sequence_gap` | missing sequence |
| `generation_mismatch` | wrong generation |
| `id_unresolved` | Dom registry miss |
| `cssom_id_unresolved` | Cssom miss |
| `part_missing` | incomplete part assembly |
| `wire_version_unknown` | bad version |
| `wire_decode_error` | corrupt payload |
| `establish_checksum_mismatch` | PP-EST-7 |
| `establish_node_count_mismatch` | PP-EST-7 |
| `resync_failed` | OOB resync could not serve |
| `anchor_miss` | input resolve exhausted retries |
| `mirror_over_budget` | mirror exceeds `mirrorMaxBytes` |
| `clock_stalled` | watchdog (fact; may force flush, not necessarily desync) |

## Phases (examples)

`establish`, `live_apply`, `resync`, `input`, `asset_serve`, `pool`, `encode`, `rewrite`.

## MUST NOT

- Soft-skip missing JSON properties as pass.  
- Publish catalogued failure without `errorCode`+`phase`.

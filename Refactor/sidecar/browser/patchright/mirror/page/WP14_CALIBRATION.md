# WP14 — Density calibration status

**Status (2026-08-12):** Stack operational. Algorithm path improved (CSSOM W4 events, auth stamp, honest cssomReady, liveAttach ≤600). **Live O1/O2/O5 three-site accept still red** → **F8 V1 file deletion still blocked**. Density baseline remains synthetic until live densify after accept.

| Item | Value |
|------|-------|
| `PP-DEN-2` baseline | [page-projection-oracles/artifacts/pp-den-2-baseline.json](../../../page-projection-oracles/artifacts/pp-den-2-baseline.json) (synthetic until live densify) |
| Live producer | **V2** `LivePageProjection` — closed-shadow+XO pierce, PageEpoch, Frame.Aggregate, W4 XO CSSOM via `styleSheetAdded`+`getStyleSheetText`, PP-EST-3 handoff, nav-aware settle |
| Collector / orphans | Hub disconnect **stops** Live; `DetachedSessionTimeout=3s` backstop; admin `stop-live` |
| Oracles | F-aware O2; `PP-ASSET-3`; hub StopSession teardown; softNav Eneba; patchright Virtual |
| Live O1 / O2 / O5 | example.com nearly green (O1 structural residual); Eneba paints but O1/O2 red; Beleza egress deny |
| C5 / W9 / F8 V1 deletion | **Deferred** until live oracles pass on Beleza / Eneba / odds |
| §5.16 knobs | LaunchRequest + public client-config projection + SurfaceHost/ProjectionClient |
| `liveAttach.ts` | **596 LOC** orch (≤600) — `cdpLive` / `assetsLive` / `emitLive` / `establishLive` |
| E6 / E7b / E11 | Revisit after O4 live densify |
| Follow-ups | Three-site accept; L2 live proof; WP16; E8 gate; density baseline on live N |

## Recalibration trigger

When live O1/O2/O5 pass on Beleza / Eneba soft-nav / live-odds against V2:

1. Delete V1 files in redesign §9 (F8).
2. Re-run `npm run oracle:density-baseline` against a real N-session lab.
3. Update knobs from measurement.

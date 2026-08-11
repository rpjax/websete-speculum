# WP14 — Density calibration status

**Status:** live V2 cutover (C1–C4) is on the product path; **§9 V1 deletion (C5) is blocked** until live O1/O2/O5 pass on the three baseline sites. Densify recalibration remains pending that gate.

| Item | Value |
|------|-------|
| `PP-DEN-2` baseline | [page-projection-oracles/artifacts/pp-den-2-baseline.json](../../../page-projection-oracles/artifacts/pp-den-2-baseline.json) |
| Current-engine knee | **1 session** (P1/P2 already exceed budgets at N=1) — recorded against **V1** producer |
| Live producer | **V2** (`LivePageProjection` / `PageProjectionEngine` → opaque §5.5 body → `ProjectionClient.ingest`); default `engine='v2'` |
| Live O1 / O2 / O5 | **Not green** on Beleza / Eneba / live-odds — unit oracles still assert FAIL on current-engine fixtures; no live dual-run accept yet |
| C5 V1 deletion (§9) | **Deferred** — keep `mirror/dom/*` producer + `DomProjector` / `PageProjectionDiffApplier` until O1/O2/O5 live pass |
| `PP-DEN-1` @100 | **blocked** until engine holds P1–P6 on V2 live |
| §5.16 knobs | Starting defaults in `PageProjectionOptions` — **MUST** use until O4 replaces |
| E6 / E7b / E11 | Unmeasured on V2; recalibrate when O4 live harness runs against the redesigned producer |

## Recalibration trigger

When live O1/O2/O5 pass on the three baseline sites against V2:

1. Delete V1 files listed in `docs/page-projection-engine-redesign.md` §9.
2. Re-run `npm run oracle:density-baseline` against a real N-session lab.
3. Update this file and set knobs from measurement (replace starting defaults).

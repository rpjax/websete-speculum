# WP14 — Density calibration status

**Status:** Armed gate unblocked (2026-08-12). Live O1/O2/O5 **execute** on V2 but are **not green** → **F8 / §9 V1 deletion blocked**.

| Item | Value |
|------|-------|
| `PP-DEN-2` baseline | [page-projection-oracles/artifacts/pp-den-2-baseline.json](../../../page-projection-oracles/artifacts/pp-den-2-baseline.json) (synthetic until live densify) |
| Live producer | **V2** `LivePageProjection` — closed-shadow+XO pierce, PageEpoch, Frame.Aggregate, mirror/asset knobs, SPA Swap/ClientState/ApplyBudget |
| Armed gate | **Fixed** — layout waiter, surface attach, NSO runner, cssom-before-head buffer, iframe `instanceof` registry walk, element-only establish checksum, fresh `contentDocument` after `open()` |
| Live O1 / O2 / O5 | **Partial** — `example.com` **PASS** via `bin/live-one.cjs`. Beleza arms but O1/O2 fail (Virtual often WAF/minimal). Eneba flaky under SignalR timeout after heavy sessions. Three-site exit still red. |
| C5 / W9 / F8 V1 deletion | **Deferred** until live oracles pass on Beleza / Eneba / odds |
| §5.16 knobs | LaunchRequest + public client-config projection + SurfaceHost/ProjectionClient |
| E6 / E7b / E11 | Revisit after O4 live densify |
| Follow-ups | W4 XO CSSOM bodies; `liveAttach.ts` LOC split (§9); L2 oracle proof; WP16 doc closure |

## Recalibration trigger

When live O1/O2/O5 pass on Beleza / Eneba soft-nav / live-odds against V2:

1. Delete V1 files in redesign §9 (F8).
2. Re-run `npm run oracle:density-baseline` against a real N-session lab.
3. Update knobs from measurement.

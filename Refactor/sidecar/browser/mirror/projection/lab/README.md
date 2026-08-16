# Projection lab (dev-only)

End-to-end PageProjection V4 **as a caller of `BrowserSession`**. The lab does not launch Chromium
or call `page.evaluate` / CDP itself — [`V4ProjectionBrowserSession`](../session/V4ProjectionBrowserSession.ts)
owns Patchright, inject, dataplane, and probes.

Production `PatchrightBrowserSession` / `LivePageProjection` is unchanged until M1 cutover.

## What it does

1. HTTP serves the **lab client** shell + fixtures (humans).
2. Client opens `ws://…/lab/session`.
3. On **Start**, `LabSession` creates a V4 `BrowserSession`, `launch` + `navigate`.
4. Session-owned dataplane receives frames; lab relays bytes → client WS for apply.
5. **Run** tab / **CLI** compose probes (CPU, invariants, isomorphism) and write `report.json`.

## Human UI

```bash
cd Refactor/sidecar
npm run lab:projection
# SPECULUM_LAB_HEADED=1 for visible Chrome
```

Open http://127.0.0.1:4077/ → **Connect**. **Start Virtual** = browse (stays up until Stop). **Run** = reboot Virtual, timed probe, then **stops Virtual** (WS stays connected). **Clear surface** empties the projected iframe.

## Agent CLI

```bash
cd Refactor/sidecar
npm run lab:run -- fixtures/demo.html 15s --cpu --iso --out lab-runs
# equivalent:
npm run lab:run -- --url fixtures/demo.html --duration 15s --cpu --iso
```

Prints the path to `lab-runs/<timestamp>-<slug>/report.json` (start diagnosis there).

**JS animation fixtures:** `fixtures/anim-js.html?fps=60` and `?fps=30` — same choreography in real seconds (smoothness, not speed). Motion is `style.transform` every tick so the producer sees `ATTR_SET`; CSS `@keyframes` would not hit MutationObserver.

**CSSOM foundation gate** (Virtual table × live, not C6 / not Projected CSS):

```bash
npm run lab:cssom-foundation
```

Runs [`cssomFoundationRun.ts`](cssomFoundationRun.ts): **observe then fold**. During the run the
caller only mutates (via `BrowserSession.evaluate` → fixture `window.__cssomLab.act`) and records
snapshots, wire op windows, and `cssomPoll` events. **Verdicts run at the end** from that journal
(`o2` / `cssomO2`, in-place `SHEET_DROP` on bytes). `cssomPoll` is I10 evidence in `report.json`;
`idle-sensor` fails only if the **whole run** recorded zero idle polls (cap on) — not a mid-run
gate. Then three `lab:run --iso` on small `cssom-scale` URLs. Not C6 / not Projected CSS.
Dossier: `lab-runs/<ts>-cssom-foundation/report.json`.

**CSSOM heavy (magazine, C6 paint + live CSS):** six constructed sheets, ~2.8k unused utilities, 18 cards that actually use the CSS. Auto theme / masthead / featured card so a human can compare Virtual vs Projected.

```bash
# You: lab UI — Connect, fixture cssom-heavy, Start Virtual. Watch cream↔ink, rust↔blue bar, hot card.
# Agent: observe-then-fold Virtual table × live (not a substitute for your eye).
npm run lab:cssom-heavy
```

Dossier: `lab-runs/<ts>-cssom-heavy/report.json`. UI **Run** with iso still writes the usual 4077 report (Projected table when the lab client is connected). `cssomPoll` is not the pass/fail.

**CSSOM poll (ops on wire, no C6 apply):** idle `requestIdleCallback` I3 walk, attach on next frame tick (CSSOM-only frames allowed); resync blocking-scans a full CSSOM snapshot. Design: `docs/page-projection/spec/cssom-poll-algorithm.md`. Fixture `cssom-scale.html?n=5000` / Instagram-shaped `n=14244&sheets=10&nested=2466` (volume is **not** the foundation gate). `report.json` → `metrics.cssomPoll`. Frames with `0xA0–0xA5` must decode (not `malformed`). Not Projected CSS parity. `flushAndSnapshot` CSSOM default `none`.
Exit `0` if every requested check is `pass` or explicit `skipped`; `1` if any `fail`.
Prefer the positional form on Windows — npm may swallow dashed flags (`--url`, `--iso`). Words without dashes still work: `iso`, `cpu`, `headed`.

| Flag | Meaning |
|------|---------|
| `--url` or 1st positional | `http(s)://…` or `fixtures/<file>` |
| `--duration` or 2nd positional | `15000` / `15s` / `1m` |
| `--cpu` or `cpu` | CDP CPU probe |
| `--iso` or `iso` | coherent snapshot at S: Virtual DOM O2 + **CSSOM O2** (`cssom: 'scan'`, verdict `isomorphism.cssom`) + **Node table×table**. Tree×tree needs the UI DOM apply (4077); skipped on CLI. Not Projected CSS / not C6 / not a second Chromium. |
| `--no-invariants` | skip wire monitor |
| `--telemetry off` | inject default-off caps |
| `--headed` | visible Chrome |
| `--out` | report root (default `lab-runs/`) |

`scripts/profile-virtual.js`, `perf-projection-lab.js`, and `collect-validation-telemetry.js` are thin wrappers of this CLI.

Env: `SPECULUM_LAB_HOST` / `PORT` / `HEADED` as before.

## Layout

```text
lab/
  index.ts                 UI server entry
  server.ts                HTTP + client WS
  session.ts               lab caller (no Chromium)
  runCli.ts                agent port
  cssomFoundationRun.ts    observe (acts/snapshots/wire/events) then fold verdicts
  cssomHeavyRun.ts         magazine fixture: settle + live CSS acts, then fold
  runTools.ts              run suite → report.json
  isomorphism.ts           halt/flush/snapshot/O2 composition
  nodeTableApply.ts        CLI caller: decode + phase-1 table apply (no DOM)
  assetRoots.ts            static/fixture paths
  cpuProfile.ts            CDP Profiler (used only inside the session)
session/
  V4ProjectionBrowserSession.ts
  projectionDataPlaneHost.ts
```

**Probes vs telemetry.** Spec: [docs/page-projection/spec/observability.md](../../../../../../docs/page-projection/spec/observability.md).
CLI `--iso` proves Virtual DOM O2 + digest at S, CSSOM table×live (`isomorphism.cssom`; not Projected, not C6), **and** table×table against a Node `ReplicatedTable` in the CLI process (same `applyFrameToTableChecked` as client phase 1). Tree×tree / DOM apply stay `skipped` (no second browser; UI at 4077 still has the live apply). That Node table is **not** Projected. O1/O4/O5 are not implemented. Event telemetry is time-series only. `FrameInvariantMonitor` is wire-bytes only.

**Halt iso is blind to same-tick ephemerals on the wire** (stress-churn stacked digits, 2026-08-14 — Virtual clean, Projected glued mid-run, halt tree including text identical). Drain prune is PP-FR-1 in `tableFrameBuilder.ts`. Narrative: [observability.md](../../../../../../docs/page-projection/spec/observability.md) §8.

## Observe then fold

Same law as `lab:run`: the **duration** (or the foundation scenario list) is observation. `report.json`
verdicts are computed **after** the world has been sampled. Do not fail mid-run because a telemetry
event did or did not arrive.

- **Act** (foundation fixture): `BrowserSession.evaluate` runs `window.__cssomLab.act(name)` in the
  Virtual page (Patchright `page.evaluate` inside [`V4ProjectionBrowserSession`](../session/V4ProjectionBrowserSession.ts)).
  That is the session eval port — not `PlaneChannel.Control`, not the frame data plane. The lab
  process still must not call Patchright/CDP itself ([observability.md](../../../../../../docs/page-projection/spec/observability.md) §1).
- **Probes** at sequence S: `flushProjectionSnapshot({ cssom: 'none'|'committed'|'scan' })`. Stored
  during the run; folded at the end.
- **Events** (`cssomPoll`): time-series in `evidence`. Closing conclusion only: zero idle polls
  across the whole run with the cap on → `idle-sensor`. Never pass/fail table or CSSOM isomorphism
  from event fields (I10).

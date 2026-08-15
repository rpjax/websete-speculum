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

**CSSOM poll cost (no wire ops yet):** `fixtures/cssom-scale.html?n=5000&mode=static|styleSet|insertRule`. Instagram-shaped: `n=14244&sheets=10&nested=2466`. Poll 5 Hz. `report.json` → `metrics.cssomPoll` (`pollMs`, `identityWalkMs`, `cssTextSerializeMs`, `lastTopLevelRulesSerialized`). Not Projected CSS parity.
Exit `0` if every requested check is `pass` or explicit `skipped`; `1` if any `fail`.
Prefer the positional form on Windows — npm may swallow dashed flags (`--url`, `--iso`). Words without dashes still work: `iso`, `cpu`, `headed`.

| Flag | Meaning |
|------|---------|
| `--url` or 1st positional | `http(s)://…` or `fixtures/<file>` |
| `--duration` or 2nd positional | `15000` / `15s` / `1m` |
| `--cpu` or `cpu` | CDP CPU probe |
| `--iso` or `iso` | coherent snapshot at S: Virtual O2 + **Node table×table** (`applyFrameToTableChecked` in the CLI process). Tree×tree needs the UI DOM apply (4077); skipped on CLI. Not Projected / not a second Chromium. |
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
CLI `--iso` proves Virtual O2 + digest at S **and** table×table against a Node `ReplicatedTable` in the CLI process (same `applyFrameToTableChecked` as client phase 1). Tree×tree / DOM apply stay `skipped` (no second browser; UI at 4077 still has the live apply). That Node table is **not** Projected. O1/O4/O5 are not implemented. Event telemetry is time-series only. `FrameInvariantMonitor` is wire-bytes only.

**Halt iso is blind to same-tick ephemerals on the wire** (stress-churn stacked digits, 2026-08-14 — Virtual clean, Projected glued mid-run, halt tree including text identical). Drain prune is PP-FR-1 in `tableFrameBuilder.ts`. Narrative: [observability.md](../../../../../../docs/page-projection/spec/observability.md) §8.

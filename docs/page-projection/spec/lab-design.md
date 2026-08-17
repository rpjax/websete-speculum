# PageProjection lab — architecture

**Status:** **shipped 2026-08-16.** This file is the architecture of the current lab (chassis, browse vs run, blueprints, dossier). The old lab was deleted the same day.  
**Audience:** humans and agents working in `Refactor/sidecar/browser/mirror/projection/lab/`.  
**Does not change:** `BrowserSession` / `V4ProjectionBrowserSession` / Virtual producer / frame protocol.  
**Does not replace:** [observability.md](observability.md) (probes vs events, coherent snapshot, I10). This file owns **lab product shape**.

§12 below is **historical** (the cutover plan). Do not start a second lab.

**Who decides architecture:** Rodrigo.  
**Conflict:** probes/events/asserts → [observability.md](observability.md) wins. Lab shape → **this file** wins over current lab code.

---

## 0. Purpose

Dev-only instrument to test, validate, debug, observe, and diagnose the PageProjection algorithm. Not product Sessions surface; as important as the product for design iteration.

---

## 1. Non-negotiables

| Rule | Meaning |
|------|---------|
| Lab is a caller | No Chromium/CDP/`page.evaluate` beside `BrowserSession` ([observability.md](observability.md) §1) |
| Do not modify `BrowserSession` | Chassis adapts to existing contract |
| UI + agents first-class | Same chassis, blueprints, dossier |
| Session identity | Virtual boot → `sessionId`; all data binds to it |
| Observe then fold | Events never pass/fail iso (I10) |
| No ad-hoc workarounds | [acceptance.md](acceptance.md) T3 |
| Lab ≠ product | No gRPC/.NET in lab host |
| Single version | New lab is the only lab |

---

## 2. Layering

```text
USE CASES:  Browse (free nav, UI)  |  Run (blueprint DAG, UI+CLI)
                └──────────── same chassis APIs ────────────┘
CHASSIS: sessionId, boot, telemetry, collectors, dossier, probes
                │
     V4ProjectionBrowserSession  (do not edit)
```

---

## 3. Chassis

**Owns:** lifecycle, `sessionId`, frame/telemetry relay, collectors, probe wrappers, dossier bind.  
**Does not own:** DAG scheduler, UI chrome, production hub.

### Session record

```text
sessionId, mode: 'browse'|'run', createdAt, url, frameRateHz, headed,
telemetry: ProjectionTelemetryConfig, cpuProfiling, blueprintId?,
dossierDir, status: 'booting'|'live'|'running'|'stopping'|'stopped'|'faulted', fault?
```

New id per boot; never recycle after dispose.

### Telemetry

Inject caps from `ProjectionTelemetryConfig` / `LAB_TELEMETRY_DEFAULTS`. Browse and run share sinks. Caller-side collectors (invariants, op windows, NDJSON) are chassis costs.

Browse Stop may export dossier. Run must write dossier.

---

## 4. Browse (free navigation)

**L2:** UI only. Flow: Connect → `browse.start` → Projected apply → navigate/clear → `browse.stop` (+ export). No action graph. No site-accept PASS from protocol greens.

---

## 5. Run (DAG)

**L9:** full scheduler — multiple queues, `dependsOn`, `awaits`, cycle detection, snap/iso exclusivity.

```text
Action {
  id: string
  type: ActionKind
  params: object
  dependsOn?: string[]      # prior success
  awaits?: string[]         # prior terminal (fold/cleanup)
  queue?: string            # default "main"
  continueOnFail?: boolean  # default false
}
```

**Safe in parallel:** collectors, op windows, `cpu.start` + `sleep`, UI apply.  
**Not safe in parallel:** two `snap`/`iso`; unordered mutating `act`s. Validator rejects >1 in-flight snap/iso.

**L3:** runs always **cold** (dispose browse Virtual → new session → graph → fold → dispose).

### Action kinds

| Kind | Params | Effect |
|------|--------|--------|
| `boot` | `frameRateHz?`, `telemetry?`, `cpuProfiling?`, `headed?` | `launch` |
| `navigate` | `url` | `navigate` |
| `sleep` | `ms` | wall wait |
| `act` | `name` | `evaluate` → `__cssomLab.act` |
| `evaluate` | `expression` | session evaluate |
| `snap` | `id`, `cssom`, `includeTree?` | flush snapshot + resume |
| `opWindow.start` / `stop` | `windowId` | CSSOM op counts on wire |
| `requestResync` | `reason?` | control resync |
| `cpu.start` / `stop` | — | CDP CPU probe |
| `iso` | `cssom?` | coherent iso (dom/cssom/table; tree if client) |
| `injectFrame` | `kind`: `attr` \| `ruleset` \| `eof` | Hostile bytes on the **client relay only** (not Virtual). EOF also `lab.tamper` ghost rule then CHECK. CLI without DOM client skips. |
| `collect.enable` | `invariants?`, `metrics?`, `nodeTableApply?` | attach collectors |
| `fold` | `ruleset` | verdicts from journal; `awaits` observation |
| `writeDossier` | — | flush shards |

### Blueprint

`lab/blueprints/<id>.json` + fold ruleset TS id (**L5**). Fields: `id`, `description`, `sessionPolicy: 'cold'`, `defaultTelemetry?`, `queues[]`, `fold`, `artifacts?`, `humanNotes?`.

---

## 6. Blueprints at cutover

### `soak`

```text
boot → navigate → collect.enable → [cpu.start] → sleep → [cpu.stop] → [iso] → fold → writeDossier
```

CLI flags = overrides, not a second runner.

### `cssom-foundation`

Port full act/snap/opWindow/resync sequence from today’s `cssomFoundationRun.ts` (styleSet window, insert/deleteRule, replaceSync, reorder/addSheet/mediaInner opWindow, addStyleEl, cross-origin, dom-append, resync, iso after mediaInner). Fold includes `ops.mediaInner` (DROP+NEW, not SET) and `sensor.idle`.

### `apply-attrs`

`boot → act attrSet → snap O2 → iso → fold`. ATTR success (table × live DOM). `iso.tree` skip if no DOM client.

### `apply-honesty-desync-attr` / `-ruleset` / `-eof`

Cold inject on the client relay (producer never emits these). Fold `apply.desync.*` requires snapshot `desynced`. CLI without iframe **skips**, does not fail Virtual O2. **2026-08-17 UI PASS** — defect was lab harness (`hostNode` 0 for constructed, wait until desynced, not apply). See [observability.md](observability.md) §7.

### `cssom-heavy`

Port theme opWindow + accent/featureCard/reorderAdopted + resync. Fold: snap oracles, `ops.theme`, `wire.desync`, `apply.nodeTable`. `humanNotes` for visual bar at 4077.

### Suite (**L1**)

`lab:cssom-foundation` sugar: sequential `lab:run` for foundation then scale soaks. Each child = own `sessionId` + dossier.

---

## 7. Dossier

```text
lab-runs/<timestamp>-<slug>/
  session.json  manifest.json  verdicts.json  meta.json
  report.json                 # L4 pointer only
  telemetry/events*.ndjson    # rotate 32 MiB (L6)
  telemetry/counts.json
  wire/invariants.json
  wire/op-windows/<id>.json
  probes/iso.json
  probes/snaps/<id>.json
  probes/cpu/...
  journal/acts.json
  journal/timeline.json
  blueprint.json
```

Exit `0` iff no `fail` in `verdicts.json`. No dual-write with monolithic report body.

---

## 8. UI + control WebSocket (**L7**)

Modes: **Browse** | **Run**. Fixture catalog from `fixtures/manifest.json` + `GET /lab/fixtures`. Stream/Activity = investigation only.

### Client → host

| type | Payload |
|------|---------|
| `hello` | `{ protocolVersion: 1 }` |
| `browse.start` | `{ url, frameRateHz?, telemetry?, headed? }` |
| `browse.stop` | `{ exportDossier?: boolean }` |
| `browse.navigate` | `{ url }` |
| `run.start` | `{ blueprintId, overrides? }` cold always |
| `run.abort` | `{ reason? }` |
| `surface.clear` | — |
| `client.telemetry` | `{ message }` |
| `client.snapshotResult` | `{ tree?, table?, sequence, desynced?, applyError? }` |
| `client.requestResync` | `{ reason? }` |

### Host → client

| type | Meaning |
|------|---------|
| `session.hello` | WS accept; connection greeting |
| `session.booted` | `{ sessionId, mode, url, dossierDir }` |
| `session.stopped` | `{ sessionId, reason, dossierDir? }` |
| `session.fault` | `{ sessionId, message }` |
| `run.progress` | `{ sessionId, actionId, queue, status, detail? }` |
| `run.complete` | `{ sessionId, dossierDir, verdictsSummary }` |
| `stats` / `telemetry` / `error` | as today conceptually |
| `requestSnapshot` | client replies `client.snapshotResult` |
| `lab.tamper` | `{ kind: 'ghostRule' }` — extra live CSS rule, no table row (EOF inject) |

**Deleted (no shim):** `start`, `stop`, `runBenchmark`, `benchmarkStarted`, `benchmarkComplete`, `clientTelemetry`, `snapshotResult` (old names), etc.

---

## 9. CLI

```bash
npm run lab:projection
npm run lab:run -- --blueprint soak --url fixtures/demo.html --duration 15s --cpu --iso
npm run lab:run -- --blueprint cssom-foundation
npm run lab:run -- --blueprint cssom-heavy
npm run lab:cssom-foundation    # sugar
npm run lab:cssom-heavy         # sugar
npm run smoke:projection-lab    # rewritten (L11)
```

Last line = absolute dossier directory.

---

## 10. Layout (**L10**)

```text
lab/
  host/        # HTTP, WS, chassis
  client/      # UI
  runner/      # DAG + CLI
  probes/      # iso, cpu, invariants, metrics, nodeTable, structuralDiff, …
  blueprints/  # *.json + fold/*.ts
  fixtures/    # HTML + manifest.json
  dossier/     # writers
  static/      # built client assets
  README.md
```

---

## 11. Verdict taxonomy (**L8**)

Coverage ≥ old gates; clearer dotted ids; map legacy→new in each fold file.

`blueprint.validate` · `action.<id>` · `snap.<id>` · `ops.<windowId>` · `iso.dom|cssom|table|tree` · `invariant.<checkId>` · `cpu` · `sensor.idle` · `wire.desync` · `apply.nodeTable` · `run`

---

## 12. Implementation plan (`feat/mirror-mode`) — historical, done 2026-08-16

**L12:** completed on this branch. New lab = only lab. Checkboxes below are a fossil of the cutover; do not treat them as open work.

### Definition of done

- [ ] Browse + Run on §8.6
- [ ] Full DAG + soak / foundation / heavy
- [ ] Sharded dossier + pointer; exit from verdicts
- [ ] Sugar thin; smoke rewritten; unit green (incl. scheduler unit tests)
- [x] grep clean: `runBenchmark`, `cssomFoundationRun`, `cssomHeavyRun`, `executeLabRun`, blob report writer
- [ ] Docs = new surface only; assert laws unchanged
- [ ] No second lab path

### Work packages

| WP | Deliver | Delete |
|----|---------|--------|
| **W0** | §10 `git mv` + dossier schema | Duplicate flat homes |
| **W1** | Chassis + new WS + Browse UI | Legacy WS vocabulary |
| **W2** | Full DAG + dossier + soak + CLI | `runTools` / old CLI / blob report |
| **W3** | Foundation + heavy + sugar | `cssom*Run.ts` |
| **W4** | Run UI (picker, progress, verdicts, fixtures) | UI bypass of runner |
| **W5** | Smoke rewrite + docs + grep clean | Dead scripts |

### Risks

Finish Browse before deleting old Browse capability; port folds before deleting CSSOM mains; no `BrowserSession` diffs; pointer `report.json` from W2.

### Non-goals

Parallel lab · cutover PR process · browse CLI · legacy shims.

---

## 13. Sealed choices (L0–L12)

| ID | Decision |
|----|----------|
| L0 | Cutover — single lab version |
| L1 | Suite = thin npm orchestrator |
| L2 | No browse CLI |
| L3 | Cold runs only |
| L4 | Thin `report.json` pointer forever |
| L5 | Blueprints JSON + fold TS |
| L6 | NDJSON 32 MiB rotate |
| L7 | Full WS redesign; no legacy names |
| L8 | Professional verdict taxonomy; coverage ≥ old |
| L9 | Full DAG at cutover |
| L10 | Full §10 layout |
| L11 | Smoke full rewrite; only lab |
| L12 | Implement on `feat/mirror-mode` only |

---

## 14. Related

[observability.md](observability.md) (assert law) · [acceptance.md](acceptance.md) · [cssom-poll-algorithm.md](cssom-poll-algorithm.md) · [oracles.md](oracles.md) · lab README (post-cutover commands only)

---

## 15. Status

**Design + plan sealed** 2026-08-16 (L0–L12). **Cutover implemented** on `feat/mirror-mode` (host/runner/blueprints/dossier; legacy mains removed).

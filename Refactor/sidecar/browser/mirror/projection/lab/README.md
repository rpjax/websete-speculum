# Projection lab (dev-only)

End-to-end PageProjection V4 **as a caller of `BrowserSession`**. The lab does not launch Chromium
or call CDP itself — `PageProjectionBrowserSession` owns Patchright, inject, dataplane, and probes.

**Architecture:** [lab-design.md](../../../../../../docs/page-projection/spec/lab-design.md) (L0–L12 cutover).  
**Assert law:** [observability.md](../../../../../../docs/page-projection/spec/observability.md).  
**Deploy:** [sidecar README](../../../README.md#pageprojection-lab-local).

## Layout

```text
lab/
  host/         HTTP + WS §8.6 + chassis
  client/       Browse / Run UI
  runner/       DAG scheduler + CLI
  probes/       iso, cpu, invariants, …
  blueprints/   soak | stress | cssom-foundation | cssom-heavy | cssom-double | apply-attrs | svg-ns | forms-state | shadow-open | iframe-open | apply-honesty-desync-* + fold/
  fixtures/     HTML + manifest.json
  dossier/      sharded report writers
  static/       client.html + built client.js
```

## Human UI

```bash
cd Refactor/sidecar
npm run lab:projection
```

Open http://127.0.0.1:4077/ → **Connect**.

- **Browse** — fixture + editable URL; Start Virtual / Navigate / Stop (export dossier).
- **Run** — blueprint picker (URL locked); soak may override duration/cpu/iso; Progress tab for timeline + verdicts; cold boot; Virtual stops when done.

## Agent CLI

```bash
npm run lab:run -- --blueprint soak fixtures/demo.html 15s iso cpu
npm run lab:run -- --blueprint stress
npm run lab:run -- --blueprint cssom-foundation
npm run lab:run -- --blueprint cssom-double
npm run lab:run -- --blueprint apply-attrs
npm run lab:run -- --blueprint svg-ns
npm run lab:run -- --blueprint forms-state
npm run lab:run -- --blueprint apply-honesty-desync-attr   # skips without DOM client
npm run lab:run -- --blueprint cssom-heavy
npm run lab:cssom-foundation   # sugar: foundation + scale soaks
npm run lab:cssom-heavy        # sugar
npm run lab:iframe-open        # UI DOM client — nested iso; CLI without client fails iso.nested
```

Last stdout line = dossier directory. Start at `report.json` (pointer) → `manifest.json` / `verdicts.json`.

Exit `0` if no `fail` in `verdicts.json`.

## Control WS (v1)

Client: `browse.start|stop|navigate`, `run.start|abort`, `surface.clear`, `client.telemetry`, `client.snapshotResult` (`desynced`/`applyError`/`armed`/`resyncInFlight`), `client.requestResync`, `client.tamperResult`, `client.injectResult`.  
Host: `session.hello|booted|stopped|fault`, `run.progress|complete`, `stats`, `telemetry`, `error`, `requestSnapshot`, `lab.tamper`, `lab.injectFrame`.

No legacy `start` / `runBenchmark` names.

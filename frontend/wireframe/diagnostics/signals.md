# Diagnostics signals

## Job
Show active resource leaks and anomalies now — actionable list backed by persisted ResourceSignal rows — and jump into Resources with evidence window + metrics.

## Route / params / auth gate
- Route: `/admin/diagnostics/signals`
- Params: `?status=active|resolved|all` (default `active`); `?kind=` optional filter
- Auth: Bearer access

## Entrada (pré-condições, deep-link)
Diagnostics hub; Resources signals strip; Health NBA; command palette.

## Layout (ASCII regiões)

```
PageHeader: Signals · [status filter]

HelperCallout: Signals are detected server-side from Telemetry samples in Journal.

[ Search/filter: kind · severity ]
[ List: signal-row … ]

Empty: No active signals — platform looks quiet for resource anomalies.
NBA: Watch resources · Configure Telemetry · Generate leakSuspect report

Reveal (row → Sheet): summary, phase, metrics snapshot, evidence sample ids,
[ Jump to Resources ] applies chartHint
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| status | select | Status | active / resolved / all | active | yes | enum |
| kind | select | Kind | All kinds | all | no | known kinds |
| severity | select | Severity | Filter | all | no | info\|warning\|critical |
| search | search-filter | Filter signals | Kind / summary text | "" | no | |
| list | list | Signals | signal-row per item | — | yes | |
| row.open | button | Open | Reveal detail Sheet | — | no | |
| jump | button | Jump to Resources | Uses `chartHint` | — | if chartHint | route with signalId |
| nba.resources | next-best-action | Watch resources | | | no | |
| nba.telemetry | next-best-action | Configure Telemetry | When empty because no samples | | no | |
| nba.report | next-best-action | Generate leak report | kind=leakSuspect | | no | report flow |

## Copy (strings)

- Title: `Signals`
- Description: `Active leaks and resource anomalies detected from Telemetry samples.`
- Empty active: `No active signals`
- Empty body: `No resource anomalies are open right now.`
- Empty CTA: `Watch resources`
- Resolved empty: `No resolved signals in this filter`
- Jump: `Jump to Resources`
- Severity labels: `Info` · `Warning` · `Critical`
- Kind labels (EN):
  - `apiMemoryLeak` → `API memory leak`
  - `hostSaturation` → `Host saturation`
  - `renderRegression` → `Render regression`
  - `threadStarvation` → `Thread pool starvation`
  - `sessionCapacitySaturation` → `Session capacity saturation`
  - `sidecarInstability` → `Sidecar instability`
  - `journalStress` → `Journal stress`
- Error: `Could not load signals`
- Detail phase: `Detection phase: {phase}`

## Inteligência UX nesta view
Primary path: scan active list → open worst severity → Jump to Resources. Not a dashboard of charts. Chart bands/evidence live on Resources after jump. Empty is success coaching, not an error.

## Path feliz (passos numerados)
1. Open Signals (active). 2. Read top critical/warning rows. 3. Open detail. 4. Jump to Resources with `chartHint`. 5. Optionally generate `leakSuspect` report.

## Reveals
Row → Sheet with metrics snapshot + evidence ids + Jump CTA.

## Estados (loading/empty/error/success/blocked)

| state | UI |
|-------|-----|
| loading | List skeleton |
| empty active | EmptyState + Watch resources |
| success | Sorted by severity then detectedAt desc |
| error | Callout + Retry |

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| list | GET | `/api/admin/diagnostics/v1/signals` | `status`, `kind?` | `{ items, total }` |
| detail | GET | `/api/admin/diagnostics/v1/signals/{id}` | — | full signal + chartHint |
| jump | navigate | `/admin/diagnostics/resources?signalId={id}` | — | Resources loads signal |

ResourceSignal fields: see [README](README.md).

## Components usados
`PageHeader`, `HelperCallout`, `EmptyState`, `NextBestAction`, `SearchFilter`, `RevealPanel` (Sheet), `StatusPill`, [`signal-row`](../components/signal-row.md).

## Navegação (vem de / sai para)
From hub / Resources strip; to Resources (jump), Reports new, Telemetry config, hub.

## Teclado / a11y notas
List is a keyboard-navigable listbox/list; Enter opens Sheet; Jump is a clear button (not icon-only). Severity not color-only.

## Aceite de build
- [ ] Active list from API — no client-only fake anomalies
- [ ] Jump applies `chartHint` via `signalId` on Resources
- [ ] Empty active is coaching, not an error tone
- [ ] Failed load is recoverable

## Explicitamente fora
Editing detector thresholds on this page; drawing the full series chart here; Host resources apply; Governance recover.

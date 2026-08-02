# Diagnostics resources

## Job
Watch live machine and process resources with chart-grade time series (same observability degree as the legacy Telemetry Monitor — CPU, memory, disk — without a god page).

## Route / params / auth gate
- Route: `/admin/diagnostics/resources`
- Params: `?from=&to=` (ISO window); `?signalId=` (apply that signal’s `chartHint`); `?live=1` (force live poll)
- Auth: Bearer access

## Entrada (pré-condições, deep-link)
Diagnostics hub Observe → Resources; Signals jump with `signalId`; Host resources NBA; Health NBA; command palette.

## Layout (ASCII regiões)

```
PageHeader: Resources · [Expand] [Generate report]

HelperCallout if Telemetry sampling off → Configure Telemetry

[ Active signals strip: “No active signals” | “N active” → Open signals ]
[ resource-system-strip: hostname · uptime · CPU% · mem · disk · load ]

[ Time presets: 15m | 1h | 6h | 24h | Custom ]
[ Live toggle ] [ Refresh ]
[ Series chips: host.cpu · host.memory · host.diskFree ] [ + Metrics ]

[ resource-series-chart — overlay mode ]
[ Point inspector on hover — min/avg/max/last when idle ]

RevealPanel: Raw samples
RevealPanel: Advanced views → link Explore (stacked / correlate / heatmap)

NBA: Open signals · Generate report for this window · Host resources
```

Above-the-fold: signals strip + system strip + chart controls + chart. Table and advanced modes are reveals / Explore.

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| signals.strip | link-strip | Active signals | Count from signals API | — | no | route `/signals` |
| system.strip | resource-system-strip | Live host | From `latest` / host section | — | yes | honest nulls |
| preset.15m | toggle | 15m | Chart window | 1h | no | exclusive presets |
| preset.1h | toggle | 1h | | selected | no | |
| preset.6h | toggle | 6h | | | no | |
| preset.24h | toggle | 24h | | | no | |
| preset.custom | toggle | Custom | Opens from/to | | no | valid range |
| from | datetime | From | Custom window start | — | if custom | ≤ to |
| to | datetime | To | Custom window end | — | if custom | ≥ from |
| live | switch | Live | Poll history ~10s + optional Journal stream | off | no | |
| refresh | button | Refresh | Reload history + latest | — | no | |
| expand | button | Expand | `/resources/explore` keeping window + metrics | — | no | |
| series.defaults | chips | host.cpu / memory / diskFree | Machine-first defaults | all three on | yes | known metric keys |
| metrics.add | metric-overlay-picker | + Metric | Sectioned catalog | closed | no | catalog keys |
| chart | resource-series-chart | Series | Overlay mode | overlay | yes | history items |
| inspector | panel | Point inspector | Hover / focus point | hidden until hover | no | |
| reveal.samples | reveal-panel | Raw samples | Paginated sample log | closed | no | |
| reveal.advanced | reveal-panel | Advanced views | Link to Explore modes | closed | no | |
| nba.signals | next-best-action | Open signals | When active count > 0 | — | no | |
| nba.report | next-best-action | Generate report | Passes current from/to | — | no | `/reports/new?from=&to=` |
| nba.host | next-best-action | Host resources | Capacity / shm | — | no | |
| nba.telemetry | next-best-action | Configure Telemetry | When sampling disabled / empty history | — | no | |

## Copy (strings)

- Title: `Resources`
- Description: `Watch machine and process series from Telemetry samples in Journal.`
- Signals ok: `No active signals`
- Signals active: `{n} active signals`
- Live: `Live`
- Refresh: `Refresh`
- Expand: `Expand`
- Add metric: `+ Metric`
- Empty history: `No samples in this window`
- Empty telemetry off: `Telemetry sampling is off — enable SampleCollected under Telemetry.`
- CTA telemetry: `Configure Telemetry`
- CTA report: `Generate report for this window`
- CTA signals: `Open signals`
- CTA host: `Host resources`
- Inspector idle: `Min · Avg · Max · Last` per visible series
- Raw samples: `Raw samples`
- Advanced: `Advanced views`
- Error history: `Could not load resource history`
- Retry: `Retry`

## Inteligência UX nesta view

- Primary path: open page → read strip → read default CPU/mem/disk chart.
- Helpers: system strip for “now”; chart for trend; signals strip for “wrong now”.
- Hidden until need: metric overlays, raw table, correlate/heatmap (Explore).
- NBA when empty Telemetry; when signals active; when operator wants a durable report.
- Recovery: Retry on history error; Configure Telemetry when no samples.
- Equal legacy observability degree; not a port of TelemetryMonitorChart monolith.

## Path feliz (passos numerados)
1. Open Resources (default 1h, three machine series).
2. Read system strip and chart.
3. Optionally add overlays (apiProcess / sessions).
4. If a signal fires, open Signals or arrive via `?signalId=` with window pre-set.
5. Generate report for the window or Expand for advanced modes.

## Reveals
- Metric overlay picker (sheet/popover).
- Raw samples reveal (table).
- Advanced views reveal → Explore route.
- Point inspector on hover/keyboard focus of a chart point.

## Estados (loading/empty/error/success/blocked)

| state | UI |
|-------|-----|
| loading | Skeleton strip + chart placeholder |
| empty (Telemetry off) | HelperCallout + NBA Configure Telemetry |
| empty (window) | EmptyState `No samples in this window` + widen preset |
| error | SaveFeedback/error callout + Retry |
| success | Strip + chart with honest nulls for missing sections |
| blocked | none (read-only watch) |
| live | Subtle live indicator; poll ~10s |

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| latest strip | GET | `/api/admin/diagnostics/v1/resources/latest` | — | composite + section readiness |
| history chart | GET | `/api/admin/diagnostics/v1/resources/history` | `from`, `to`, `limit`, `bucketSeconds?`, `cursor?` | `items[].sample`, cursor |
| signals strip | GET | `/api/admin/diagnostics/v1/signals?status=active` | — | `total`, optional top severities |
| signal jump | GET | `/api/admin/diagnostics/v1/signals/{id}` | from `?signalId=` | `chartHint` → from/to + metricKeys |
| live stream | hub | `StreamJournalAsync` | — | filter `Telemetry.Sampling.SampleCollected` |
| create report deep-link | — | `/admin/diagnostics/reports/new?step=period&from=&to=` | query | report flow |

Metric keys: see [README metric catalog](README.md). Defaults: `host.cpu`, `host.memory`, `host.diskFree`.

## Components usados
`PageHeader`, `HelperCallout`, `EmptyState`, `NextBestAction`, `RevealPanel`, `StatusPill`, [`resource-system-strip`](../components/resource-system-strip.md), [`resource-series-chart`](../components/resource-series-chart.md), [`metric-overlay-picker`](../components/metric-overlay-picker.md), [`signal-row`](../components/signal-row.md) (strip summary may reuse StatusPill only).

## Navegação (vem de / sai para)
From hub / signals / health / host-resources; to Explore, Signals, Reports new, Host resources, Telemetry config, hub.

## Teclado / a11y notas
- Chart: keyboard focusable series; inspector announced on point change.
- Live toggle has accessible name `Live refresh`.
- Presets are a radiogroup.
- Do not rely on color alone for warn/danger thresholds on strip.

## Aceite de build
- [ ] Default chart shows host CPU, memory, disk free from history API
- [ ] System strip uses latest (or honest unavailable)
- [ ] Missing sample sections render gaps/nulls — no cross-fill host↔apiProcess
- [ ] `?signalId=` applies `chartHint` window + metrics
- [ ] Raw samples and advanced modes are not permanently stacked
- [ ] No TelemetryMonitor monolith component shipped as this page

## Explicitamente fora
Host resources apply/preview; Governance elevate/recover; Timeline narrative; Lab panels; fake health scores; dumping full sample JSON as primary UI.

# Diagnostics hub

## Job
~~Dispatch hub~~ — **retired as a nav landing**. Diagnostics is a **sidebar section** with direct pages (Health, Resources, Signals, Timeline, Investigate, Reports, Governance). `/admin/diagnostics` redirects to Health.

## Route / params / auth gate
- Route: `/admin/diagnostics` → redirect to `/admin/diagnostics/health`
- Auth: Bearer access

## Entrada (pré-condições, deep-link)
Admin nav, Home shortcut, command palette, or NBA from Host resources / Telemetry config.

## Layout (ASCII regiões)

```
PageHeader: Diagnostics
HelperCallout: Observability jobs — watch resources, act on signals, read reports.

┌ Observe ──────────────────────────────┐
│ Health     → /admin/diagnostics/health │
│ Resources  → …/resources (charts)      │
│ Signals    → …/signals (leaks now)     │
└────────────────────────────────────────┘

┌ Investigate ───────────────────────────┐
│ Timeline   → …/timeline                │
│ Investigate→ …/investigate             │
│ Reports    → …/reports                 │
└────────────────────────────────────────┘

┌ Govern ────────────────────────────────┐
│ Governance → …/governance              │
└────────────────────────────────────────┘

NBA: Configure Telemetry · Host resources · Open resources
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| observe.health | card | View health | Runtime overview | — | — | route |
| observe.resources | card | Watch resources | Live strip + CPU/mem/disk series | — | — | route |
| observe.signals | card | Open signals | Active leaks and anomalies | — | — | route |
| investigate.timeline | card | Open timeline | Narrative evidence | — | — | route |
| investigate.probes | link | Investigate | Scope → probe | — | — | route |
| investigate.reports | card | Open reports | Journal-backed reports | — | — | route |
| govern | card | Open governance | Elevate / recover / toggles | — | — | route |
| nba.telemetry | link | Configure Telemetry | Sampler settings | — | — | `/admin/configurations/Telemetry` |
| nba.host | link | Host resources | Capacity / shm | — | — | `/admin/host-resources` |

## Copy (strings)

- Title: `Diagnostics`
- Description: `Choose the operator job: observe the platform, investigate evidence, or govern observability.`
- Banner: `Resources charts and signals use Telemetry samples in Journal. Enable sampling under Telemetry if the watch surfaces are empty.`
- Card actions: `View health` · `Watch resources` · `Open signals` · `Open timeline` · `Open reports` · `Open governance`
- Card helpers: Health — `Runtime and degraded state`; Resources — `Machine and process series (CPU, memory, disk)`; Signals — `Active leaks and saturation`; Reports — `Materialized Journal windows`

## Inteligência UX nesta view
Three job columns, no mega-page. Resources owns chart-grade watch; Signals owns “something wrong now”; Reports owns deep windows. Child routes stay honest until APIs ship — coaching empties, never fake gauges.

## Path feliz (passos numerados)
1. Open Diagnostics. 2. Pick Resources for live watch, or Signals if a banner shows active issues. 3. Generate a report from a Resources window when needed.

## Reveals
None on hub (cards only).

## Estados (loading/empty/error/success/blocked)
Hub always loads; optional badge on Signals card when `GET …/signals?status=active` returns `total > 0`.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| signals badge | GET | `/api/admin/diagnostics/v1/signals?status=active` | — | `total` |

## Components usados
`PageHeader`, `HelperCallout`, `NextBestAction`, `StatusPill` (optional badge).

## Navegação (vem de / sai para)
From Admin nav / Home; to child Diagnostics routes; NBA to Telemetry config and Host resources.

## Teclado / a11y notas
Cards are links; focus order Observe → Investigate → Govern.

## Aceite de build
- [ ] All job routes reachable from hub
- [ ] No TelemetryMonitor god chart embedded on hub
- [ ] Signals card can show active count without inventing severity scores

## Explicitamente fora
Legacy monitors, timeline canvas, analysis pipeline, TelemetryMonitor god chart, fake health scores, Host resources apply wizard.

# Diagnostics resources explore

## Job
Expand the Resources chart for denser brush interaction and advanced view modes (stacked lanes, correlation, heatmap) without packing them into the primary Resources page.

## Route / params / auth gate
- Route: `/admin/diagnostics/resources/explore`
- Params: `?from=&to=&metrics=` (comma-separated metric keys); `?live=1`; `?view=overlay|stacked|correlate|heatmap`
- Auth: Bearer access

## Entrada (pré-condições, deep-link)
Resources → Expand; preserves window and selected metrics via query.

## Layout (ASCII regiões)

```
PageHeader: Resources explore · [Back to Resources]

[ Time presets + Custom + Live + Refresh ]
[ metric-overlay-picker always reachable ]
[ View mode: Overlay | Stacked | Correlate | Heatmap ]
[ Scale: Absolute | Normalized | Indexed ]
[ Granularity: Raw | Auto | 1m | 5m | 15m | 1h ] [ Agg: Avg | Max | Min | Last ]

[ resource-series-chart — taller viewport ]
[ Brush: Shift+drag → custom from/to ]
[ Point inspector ]

Reveal: Raw samples
NBA: Generate report for this window · Open signals
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| back | link | Back to Resources | Same window/metrics | — | no | route |
| view | radio | View mode | Overlay default | overlay | yes | enum |
| scale | radio | Scale | Unlike units | absolute | yes | enum |
| granularity | select | Granularity | Maps to bucketSeconds | Auto | yes | |
| agg | select | Aggregation | Bucket agg | Avg | yes | |
| brush | chart gesture | Brush range | Shift+drag sets custom from/to | — | no | |
| chart | resource-series-chart | Series | Taller | — | yes | |
| metrics | metric-overlay-picker | Metrics | Sectioned | from query | yes | catalog |
| live / refresh / presets | same as Resources | | | | | |
| nba.report | next-best-action | Generate report | | | no | |
| reveal.samples | reveal-panel | Raw samples | | closed | no | |

## Copy (strings)
- Title: `Resources explore`
- Description: `Advanced series views for the selected window.`
- Back: `Back to Resources`
- Views: `Overlay` · `Stacked` · `Correlate` · `Heatmap`
- Scales: `Absolute` · `Normalized` · `Indexed`
- Brush help: `Shift+drag to set a custom range`

## Inteligência UX nesta view
Primary path: inspect with Overlay/Stacked; Correlate/Heatmap only when comparing unlike series. Brush updates URL `from`/`to`. Does not own signals list or report chapters.

## Path feliz (passos numerados)
1. Expand from Resources. 2. Optionally switch view/scale. 3. Brush a sub-window. 4. Back or Generate report.

## Reveals
Raw samples; metric picker.

## Estados (loading/empty/error/success/blocked)
Same honesty rules as Resources; Correlate needs ≥2 numeric series or coaching empty.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| history | GET | `/api/admin/diagnostics/v1/resources/history` | from, to, limit, bucketSeconds | items |
| latest | GET | `/api/admin/diagnostics/v1/resources/latest` | — | optional strip |

## Components usados
`PageHeader`, `HelperCallout`, `EmptyState`, `NextBestAction`, `RevealPanel`, `resource-series-chart`, `metric-overlay-picker`.

## Navegação (vem de / sai para)
From Resources Expand; back to Resources; to Reports new with window.

## Teclado / a11y notas
View/scale as radiogroups; brush alternative: Custom from/to fields (same as Resources).

## Aceite de build
- [ ] Query preserves metrics and window from Resources
- [ ] Advanced modes not required on primary Resources page
- [ ] Correlate empty state when fewer than two series

## Explicitamente fora
Signal detector controls; Governance; embedding Host resources wizard; god-page stacking of hints table permanently visible.

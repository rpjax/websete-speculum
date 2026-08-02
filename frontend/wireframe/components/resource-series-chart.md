# resource-series-chart

## Papel
Time-series visualization for Telemetry sample metrics (CPU, memory, disk, overlays). Delivers legacy Telemetry Monitor chart **quality** as a focused component — not a page that owns strip + hints + table + all modes.

## Quando usar / não usar
Use: Diagnostics Resources (overlay default); Resources Explore (all view modes).  
Don’t: Hub; Signals list; Host resources; dumping JSON points as the primary UI.

## Variantes / props

| prop | type | notes |
|------|------|-------|
| `items` | `{ id, publishedAt, sample }[]` | History response |
| `metricKeys` | string[] | e.g. `host.cpu`, `host.memory` |
| `view` | `overlay` \| `stacked` \| `correlate` \| `heatmap` | Resources forces `overlay` |
| `scale` | `absolute` \| `normalized` \| `indexed` | Explore |
| `bucketSeconds` | number? | Display hint |
| `from` / `to` | string ISO | Window |
| `onBrush` | `(from, to) => void` | Explore Shift+drag |
| `onPointFocus` | `(point) => void` | Inspector |
| `signalBands` | `{ from, to, severity, kind }[]?` | Optional active-signal windows |
| `height` | `normal` \| `tall` | Explore = tall |

Honest nulls: if a section is null on a sample, that series gaps — never substitute another section’s field.

## Estados
loading · empty window · error (parent) · ready · brushing · inspecting.

## Copy default
- Empty: `No samples in this window`
- Correlate need: `Select at least two metrics to correlate`
- Inspector idle footer: `Min · Avg · Max · Last`

## A11y
Chart region labelled `Resource series`; provide a data table alternative in the Raw samples reveal (page-owned). Keyboard: move between points with arrows when focused; announce inspector values.

## Usado por (páginas)
`diagnostics/resources.md`, `diagnostics/resources-explore.md`.

## Aceite de build
- [ ] Defaults render `host.cpu`, `host.memory`, `host.diskFree` when those keys selected
- [ ] Missing section → gap, not fabricated line
- [ ] Does not embed system strip, signals list, or raw table internally (composition stays on the page)

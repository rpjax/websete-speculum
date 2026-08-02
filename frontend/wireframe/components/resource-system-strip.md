# resource-system-strip

## Papel
Compact live host strip: hostname, uptime, CPU %, memory used/total, disk free/total, load — “now” read beside the Resources chart.

## Quando usar / não usar
Use: Diagnostics Resources (and optionally Explore header).  
Don’t: Host resources capacity hero (different job); don’t replace the time-series chart; don’t invent values when API sections are null.

## Variantes / props

| prop | type | notes |
|------|------|-------|
| `host` | `HostTelemetry \| null` | From `resources/latest` |
| `updatedAt` | string ISO? | Sample / probe time |
| `warnCpuPct` | number | default 85 — tone warning |
| `dangerCpuPct` | number | default 95 |
| `warnMemPct` | number | default 85 |
| `dangerMemPct` | number | default 95 |

## Estados
loading (skeleton cells) · ready · unavailable (`host` null / source unavailable) · stale (optional when live lag).

## Copy default
- Labels: `CPU` · `Memory` · `Disk` · `Load` · `Up`
- Unavailable: `Host sample unavailable`
- Source hint when present: `machine` / `cgroup` (quiet secondary text)

## A11y
Each metric is a labelled group; warn/danger include text tone or icon + label, not color alone. Uptime as text, not only a bar.

## Usado por (páginas)
`diagnostics/resources.md`; optional on `diagnostics/resources-explore.md`.

## Aceite de build
- [ ] Null host fields show em dash / unavailable — no cross-fill from apiProcess
- [ ] Thresholds change tone without hiding the numeric value

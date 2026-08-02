# signal-row

## Papel
One ResourceSignal in a list: kind label, severity pill, summary, detectedAt, optional Jump affordance.

## Quando usar / não usar
Use: Diagnostics Signals list; compact variant optional on Resources active-signals strip.  
Don’t: full report chapters; don’t draw charts inside the row.

## Variantes / props

| prop | type | notes |
|------|------|-------|
| `signal` | ResourceSignal summary | id, kind, severity, status, summary, detectedAt, chartHint? |
| `dense` | boolean | strip vs list |
| `onOpen` | () => void | Open detail Sheet |
| `onJump` | () => void | Resources with signalId |

## Estados
static · focus · selected (detail open).

## Copy default
Kind labels from `diagnostics/signals.md`. Severity via `StatusPill` tones: info→info, warning→warning, critical→danger.

## A11y
Row is a single tab stop or button; Jump is a separate labelled control when shown. Severity includes text label.

## Usado por (páginas)
`diagnostics/signals.md`; optional summary on `diagnostics/resources.md` strip.

## Aceite de build
- [ ] Critical/warning/info distinguishable without color alone
- [ ] Jump only enabled when `chartHint` present (or always navigates with `signalId` for server lookup)

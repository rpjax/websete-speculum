# Diagnostics health

## Job
Observe the diagnostics runtime health when its overview API is available.

## Route / params / auth gate
- Route: `/admin/diagnostics/health`
- Params: none
- Auth: Bearer access

## Entrada (pré-condições, deep-link)
Opened from the Diagnostics Observe card.

## Layout (ASCII regiões)

```
PageHeader: Health
[Available / Coming callout]
[Runtime overview when API present]
[Honest empty when not]
NBA → Watch resources | Configure Telemetry | Diagnostics hub
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| return | link | Diagnostics | Select another job | visible | no | route |
| nba.resources | link | Watch resources | Live CPU / memory / disk series | visible | no | `/admin/diagnostics/resources` |
| nba.telemetry | link | Configure Telemetry | Sampler settings | visible | no | route |
| nba.signals | link | Open signals | When degraded or active signals | optional | no | route |

## Copy (strings)
- Title: `Health`
- Description: `Runtime overview for Diagnostics capabilities and degraded state.`
- Empty: `No health snapshot is available yet`
- Coming: `Coming: runtime overview API`
- NBA resources: `Watch live machine and process series`
- NBA telemetry: `Configure Telemetry`
- CTA resources: `Watch resources`

## Inteligência UX nesta view
Never renders fictional health, legacy monitors, or optimistic gauges. Empty is coaching. When overview exists, link to Resources for chart-grade watch — Health is not the TelemetryMonitor.

## Path feliz (passos numerados)
1. Open Observe health. 2. Read runtime state or availability. 3. NBA to Resources for series, or Telemetry if sampling is off.

## Reveals
Technical capability maps only after overview payload exists (reveal panel).

## Estados (loading/empty/error/success/blocked)
Empty is honest until overview ships; error preserves return path; success shows overview fields only from API.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| overview | GET | `/api/admin/diagnostics/v1/overview` | none | runtime state |
| signals hint | GET | `/api/admin/diagnostics/v1/signals?status=active` | — | `total` optional |

## Components usados
`PageHeader`, `HelperCallout`, `EmptyState`, `NextBestAction`, `RevealPanel`.

## Navegação (vem de / sai para)
From Diagnostics hub; to Resources, Signals, Telemetry config, hub.

## Teclado / a11y notas
Empty state is readable and does not rely on decoration.

## Aceite de build
- [ ] No fake widget or ported legacy monitor appears
- [ ] NBA to Resources is present when operator needs watch

## Explicitamente fora
Recover/elevate controls before the runtime contract exists; resource time-series charts (those belong on Resources).

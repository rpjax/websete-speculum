# Diagnostics reports

## Job
List Journal-backed ResourceReport artifacts and start the generate-report flow.

## Route / params / auth gate
- Route: `/admin/diagnostics/reports`
- Params: none (optional `?kind=` filter later)
- Auth: Bearer access

## Entrada (pré-condições, deep-link)
Diagnostics hub Investigate → Reports; Resources / Explore NBA “Generate report”; Signals leak report NBA.

## Layout (ASCII regiões)

```
PageHeader: Reports · [Generate report]

HelperCallout: Reports are materialized from Telemetry samples in Journal — not live charts.

[ List: kind · status · window · createdAt · Open ]
Empty: No reports yet · [Generate report]

NBA: Watch resources · Open signals
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| generate | button | Generate report | Opens report flow | — | yes | route `/reports/new` |
| list | list | Reports | Row per ResourceReport | — | yes | |
| row.open | link | Open | Detail | — | no | `/reports/:id` |
| filter.kind | select | Kind | Optional | all | no | report kinds |
| nba.resources | next-best-action | Watch resources | | | no | |
| nba.signals | next-best-action | Open signals | | | no | |

## Copy (strings)
- Title: `Reports`
- Description: `Materialized Journal windows for trends, leaks, saturation, and Journal health.`
- Generate: `Generate report`
- Empty: `No reports yet`
- Empty body: `Generate a report from a time window of Telemetry samples.`
- Empty CTA: `Generate report`
- Status: `Pending` · `Ready` · `Failed`
- Kind labels: `Resource trend` · `Leak suspect` · `Saturation window` · `Journal health`
- Error: `Could not load reports`

## Inteligência UX nesta view
Primary path: Generate report or open latest ready. Pending rows show status pill; failed rows show errorCode/phase on detail. Not a chart page.

## Path feliz (passos numerados)
1. Open Reports. 2. Generate report (flow). 3. Open ready detail.

## Reveals
None on list (detail owns chapters).

## Estados (loading/empty/error/success/blocked)
Loading skeleton; empty coaching; error + Retry; success list sorted `createdAt` desc.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| list | GET | `/api/admin/diagnostics/v1/reports` | optional kind | `{ items, total }` |
| open | GET | navigate detail | id | — |

## Components usados
`PageHeader`, `HelperCallout`, `EmptyState`, `NextBestAction`, `StatusPill`, `SearchFilter` (optional).

## Navegação (vem de / sai para)
From hub / Resources; to report-flow, report-detail, Resources, Signals.

## Teclado / a11y notas
Generate is primary button; list rows are links.

## Aceite de build
- [ ] List uses `{ items, total }`
- [ ] Generate enters report-flow
- [ ] Failed status visible without opening (pill)

## Explicitamente fora
Inline chart god surface; editing Journal config here (link Telemetry/Journal sections instead if needed).

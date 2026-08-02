# Report flow — review

## Job
Confirm kind + window and submit ResourceReport creation; then open the pending detail.

## Route / params / auth gate
- Route: `/admin/diagnostics/reports/new?step=review`
- Params: `kind`, `from`, `to` required
- Auth: Bearer access

## Entrada (pré-condições, deep-link)
After period step with valid query state.

## Layout (ASCII regiões)

```
PageHeader: Generate report
StepWizard: step 3 Review

[ Summary card ]
  Kind: {label}
  Window: {from} → {to}
  Source: Journal Telemetry.Sampling.SampleCollected

HelperCallout: Materialization runs on the server; you will open a pending report.

[ Back ] [ Generate ]
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| wizard | step-wizard | Progress | | review | yes | |
| summary | card | Semantic summary | Kind + window | | yes | |
| back | button | Back | To period | | no | |
| submit | button | Generate | POST create | | yes | |
| feedback | save-feedback | Result | | | no | |

## Copy (strings)
- Step: `Review`
- Generate: `Generate`
- Success navigate: pending detail
- Error: `Could not create report` + server `error` message
- Callout: `The API materializes chapters from Journal samples. Large windows stay pending until ready.`

## Inteligência UX nesta view
Primary path: read summary → Generate. No editing on review (Back to change). On success navigate to `/admin/diagnostics/reports/{id}` (pending).

## Path feliz (passos numerados)
1. Confirm summary. 2. Generate. 3. Land on report detail (pending → ready).

## Reveals
None.

## Estados (loading/empty/error/success/blocked)
Submitting disables Generate; error shows save-feedback with retry; success navigates away.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| create | POST | `/api/admin/diagnostics/v1/reports` | `{ kind, from, to }` camelCase | `{ id, status }` |
| open | navigate | `/admin/diagnostics/reports/{id}` | | |

## Components usados
`PageHeader`, `StepWizard`, `HelperCallout`, `SaveFeedback`.

## Navegação (vem de / sai para)
From period; to report-detail; back to period; cancel to reports list.

## Teclado / a11y notas
Generate is default submit; Escape does not abandon without confirm if dirty — flow state is query-based so Back is enough.

## Aceite de build
- [ ] POST body uses camelCase kind/from/to
- [ ] Success navigates to detail id
- [ ] Error does not invent a ready report

## Explicitamente fora
Client-side chapter generation; claiming ready from HTTP 200 without `status`.

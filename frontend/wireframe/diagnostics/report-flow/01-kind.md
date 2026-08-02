# Report flow — kind

## Job
Choose which ResourceReport kind to materialize.

## Route / params / auth gate
- Route: `/admin/diagnostics/reports/new?step=kind`
- Params: optional `kind` preselect; `from`/`to` preserved in query for later steps
- Auth: Bearer access

## Entrada (pré-condições, deep-link)
Reports Generate; Resources NBA with from/to; Signals `kind=leakSuspect`.

## Layout (ASCII regiões)

```
PageHeader: Generate report
StepWizard: Kind → Period → Review  (step 1)

[ Guided cards ]
  Resource trend
  Leak suspect
  Saturation window
  Journal health

[ Next ]
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| wizard | step-wizard | Progress | | kind | yes | |
| kind.resourceTrend | radio-card | Resource trend | Host/API/sessions trends | | yes | one kind |
| kind.leakSuspect | radio-card | Leak suspect | Windows where leak signals were active | | | |
| kind.saturationWindow | radio-card | Saturation window | Host or capacity saturation | | | |
| kind.journalHealth | radio-card | Journal health | Admission/drops/pressure | | | |
| next | button | Next | To period | | yes | kind selected |

## Copy (strings)
- Title: `Generate report`
- Step: `Kind`
- Helpers:
  - Resource trend: `Summarize host, API process, and session series for a window.`
  - Leak suspect: `Focus on API memory leak and related signals.`
  - Saturation window: `Host CPU/memory or session capacity pressure.`
  - Journal health: `Journal queue depth, drops, and persist pressure.`
- Next: `Next`
- Cancel: `Back to reports`

## Inteligência UX nesta view
Primary path: pick a card → Next. Prefill kind from query when present.

## Path feliz (passos numerados)
1. Select kind. 2. Next → period.

## Reveals
None.

## Estados (loading/empty/error/success/blocked)
Static; invalid if Next without selection (inline validation).

## Dados / API
None yet (kind kept in query/state until review POST).

## Components usados
`PageHeader`, `StepWizard`, `GuidedPreset` / radio-cards, `InlineValidation`, `HelperCallout`.

## Navegação (vem de / sai para)
From reports; to `?step=period`; back to `/admin/diagnostics/reports`.

## Teclado / a11y notas
Cards as radiogroup; Enter on Next.

## Aceite de build
- [ ] Exactly one kind required before Next
- [ ] Prefill `kind` from query works

## Explicitamente fora
Period editing on this step; POST create.

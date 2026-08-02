# Report flow — period

## Job
Choose the Journal sample window for the report.

## Route / params / auth gate
- Route: `/admin/diagnostics/reports/new?step=period`
- Params: `kind` required (from step 1); `from`/`to` optional prefill
- Auth: Bearer access

## Entrada (pré-condições, deep-link)
After kind; Resources NBA may land with from/to already set (`?step=period&kind=&from=&to=` — if kind missing, bounce to kind preserving from/to).

## Layout (ASCII regiões)

```
PageHeader: Generate report
StepWizard: step 2 Period

[ Presets: 15m | 1h | 6h | 24h | Custom ]
[ From ] [ To ]

HelperCallout: Wider windows take longer to materialize.

[ Back ] [ Next ]
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| wizard | step-wizard | Progress | | period | yes | |
| preset.* | toggle | Window presets | | 1h or prefill | yes | |
| from | datetime | From | Inclusive start UTC | | yes | < to |
| to | datetime | To | Inclusive end UTC | | yes | > from |
| back | button | Back | To kind | | no | |
| next | button | Next | To review | | yes | valid range |

## Copy (strings)
- Step: `Period`
- Helper: `Reports read Telemetry.Sampling.SampleCollected facts in this window.`
- Warn long: `Windows over 24h may take longer to materialize.`
- Next: `Next`
- Back: `Back`
- Validation: `Choose a valid from/to range`

## Inteligência UX nesta view
Primary path: accept prefilled Resources window or pick 1h → Next. Custom only when needed.

## Path feliz (passos numerados)
1. Confirm or set from/to. 2. Next → review.

## Reveals
None.

## Estados (loading/empty/error/success/blocked)
Blocked Next until valid range; if `kind` missing, redirect to kind step.

## Dados / API
None (window in query/state). Optional: lightweight `GET …/resources/history?limit=1` to coach “samples exist” — not required for DNA.

## Components usados
`PageHeader`, `StepWizard`, `HelperCallout`, `InlineValidation`.

## Navegação (vem de / sai para)
Kind ↔ Review; cancel to reports list.

## Teclado / a11y notas
Presets radiogroup; datetime fields labelled.

## Aceite de build
- [ ] Prefill from Resources query preserved
- [ ] Invalid range blocks Next with inline message

## Explicitamente fora
POST create; chart embed on this step.

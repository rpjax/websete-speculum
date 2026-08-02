# step-wizard

## Papel
Multi-step progress with next/back and safe abandon for flows.

## Quando usar / não usar
Use: setup, injection-flow, upload if multi-step.  
Don’t: single-field pages; dashboards.

## Variantes / props
- `steps: { id, title }[]`
- `currentIndex: number`
- `onBack`, `onContinue` (continue optional — pages own primary CTA)
- `allowAbandon: boolean` → link Cancel

## Estados
first / middle / last; continueDisabled.

## Copy default
- Back: `Back`
- Continue: `Continue` (page may override)
- Cancel: `Cancel`

## A11y
`nav` with `aria-label="Progress"`; current step `aria-current="step"`.

## Usado por
setup/guided-first-config; scripts/injection-flow/*; scripts/upload-flow (optional).

## Aceite de build
- [ ] Back does not skip confirmation when page marks dirty (page responsibility)
- [ ] Step titles visible

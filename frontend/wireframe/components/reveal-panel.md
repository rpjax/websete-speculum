# reveal-panel

## Papel
Hide advanced or dense detail until the operator asks.

## Quando usar / não usar
Use: technical session details; advanced config; optional JSON.  
Don’t: hide the primary path.

## Variantes / props
- `title`, `defaultOpen: false`, `children`
- variant: accordion | sheet

## Estados
collapsed / expanded.

## Copy default
Trigger: page title e.g. `Technical details` / `Advanced`.

## A11y
`aria-expanded`; focus moves to panel on open for Sheet.

## Usado por
sessions/live-detail; setup/guided-first-config; scripts/injection-flow/03–04.

## Aceite de build
- [ ] Default collapsed unless page says otherwise
- [ ] Escape closes Sheet variant

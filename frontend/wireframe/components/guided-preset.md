# guided-preset

## Papel
One-click shortcuts that fill domain fields (positions, match-all rules).

## Quando usar / não usar
Use: injection placement/targets.  
Don’t: hide required understanding — presets should be reversible by editing fields.

## Variantes / props
- `presets: { id, label, apply: () => void }[]`

## Estados
idle / applied (optional brief check).

## Copy default
Page-supplied preset labels.

## A11y
Buttons in a group `aria-label="Presets"`.

## Usado por
scripts/injection-flow/02-placement; 03-targets.

## Aceite de build
- [ ] Activating preset updates visible fields
- [ ] User can still edit after

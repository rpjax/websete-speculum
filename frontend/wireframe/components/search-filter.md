# search-filter

## Papel
Debounced text filter for lists (semantic query, not JSON).

## Quando usar / não usar
Use: scripts library; sessions list.  
Don’t: full power query builders in V1.

## Variantes / props
- `value`, `onChange`, `placeholder`, `debounceMs` default 200

## Estados
idle / debouncing.

## Copy default
Placeholder page-supplied (`Search scripts`, `Filter sessions`).

## A11y
`role=search`; input labeled.

## Usado por
scripts/library; sessions/live-list.

## Aceite de build
- [ ] Debounce prevents request spam
- [ ] Clear control optional

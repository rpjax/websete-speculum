# metric-overlay-picker

## Papel
Sectioned metric catalog to add/remove chart overlays (host / apiProcess / sessions / sidecar / journal / docker / derived). Searchable; machine metrics first.

## Quando usar / não usar
Use: Resources (+ Metric); Resources Explore.  
Don’t: as a standalone settings page; don’t list legacy Motor/pipeline storage keys — Refactor Telemetry sections only.

## Variantes / props

| prop | type | notes |
|------|------|-------|
| `selected` | string[] | metric keys |
| `onChange` | `(keys: string[]) => void` | |
| `catalog` | section → key[] | From DNA README catalog |
| `open` | boolean | Controlled sheet/popover |

## Estados
closed · open · filtered empty.

## Copy default
- Trigger: `+ Metric`
- Sections: `Host` · `API process` · `Sessions` · `Sidecar` · `Journal` · `Docker` · `Derived`
- Search placeholder: `Filter metrics…`
- Empty filter: `No metrics match`

Default recommended keys (pre-selected by page, not by picker alone): `host.cpu`, `host.memory`, `host.diskFree`.

## A11y
Dialog/popover with listbox multi-select; Escape closes; checkboxes or toggleable options with names = metric labels.

## Usado por (páginas)
`diagnostics/resources.md`, `diagnostics/resources-explore.md`.

## Aceite de build
- [ ] Catalog matches diagnostics README keys
- [ ] Cannot select unknown keys
- [ ] Search filters across sections

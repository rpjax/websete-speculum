# Injection flow — 02 Placement

## Job
Choose injection position and execution type (Classic vs Module).

## Route
Step `placement` on new/edit injection routes.

## Entrada
Completed source step.

## Layout

```
step-wizard step 2 of 4
Position: presets + select (HeadStart / HeadEnd / BodyStart / BodyEnd)
Execution: Classic | Module
helper-callout: Module = type=module on script tag
[ Back ] [ Continue ]
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| position | select | Position | Where the tag is inserted | HeadEnd | yes | enum `ScriptInjectionPosition` |
| positionPresets | guided-preset | Quick picks | Head start / Body end | — | no | sets position |
| execution | radio | Execution | Classic vs Module | Classic | yes | enum `ScriptExecutionType` |

## Copy

- Presets map to API enums (JSON camelCase): `Head start` → `headStart`; `Before </head>` → `headEnd`; `Body start` → `bodyStart`; `Body end` → `bodyEnd`
- Module helper: `Module scripts use type="module".`
- Enum contract: `HeadStart` \| `HeadEnd` \| `BodyStart` \| `BodyEnd` (not HeaderTop/BodyTop aliases).

## Inteligência UX nesta view

- Primary path: pick position (preset) + execution → Continue.
- Helpers: `guided-preset`, `helper-callout`.
- Reveal: none.

## Path feliz
Continue → 03 Targets.

## Reveals
None.

## Estados
idle.

## Dados / API
None until review (draft only). Enums match `ScriptInjectionPosition`, `ScriptExecutionType`.

## Components usados
`step-wizard`, `guided-preset`, `helper-callout`.

## Navegação
Back → source; Continue → targets.

## Teclado / a11y
Presets are buttons setting the select.

## Aceite de build
- [ ] Presets set position
- [ ] Back preserves source draft

## Explicitamente fora
Custom HTML position strings.

# Scripts — remove injection

## Job
Remove one injection from `Scripting.Injections` after explicit confirm + review summary, then PUT the full Scripting section.

## Route / params / auth gate
- Route: `/admin/scripts/injections/:index/remove`
- Auth: bearer

## Entrada
Injections list **Remove** on a card.

## Layout

```
PageHeader: Remove injection
confirm-destructive + summary card (source · position · execution · rules)
[ Cancel ]  [ Remove and apply ]
save-feedback on error
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| summary | readonly | — | Semantic summary of injection at index | — | — | |
| cancel | button | Cancel | — | — | — | → injections tab |
| confirm | button | Remove and apply | Writes Scripting without this item | — | — | |

## Copy

- Title: `Remove injection`
- Body: `This updates Scripting configuration. Matching pages will no longer receive this script.`
- Confirm: `Remove and apply`
- Success toast: `Scripting configuration applied`
- Not found index: `This injection no longer exists.` → back to list

## Inteligência UX nesta view

- Primary path: Cancel (safe) or Remove and apply.
- Helpers: `confirm-destructive`, `save-feedback`.
- Not a silent list-delete — apply goes through this review (principle: review before apply).
- Recovery: stay on page with server validation message.

## Path feliz

1. GET `/api/configurations/Scripting`.
2. Show summary for `injections[index]`.
3. On confirm: remove index; PUT full section.
4. Success → `/admin/scripts?tab=injections`.

## Reveals
Optional collapsed JSON of the removed item only.

## Estados
loading / ready / applying / error / not-found.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| Load | GET | `/api/configurations/Scripting` | — | `injections[]` |
| Apply | PUT | `/api/configurations/Scripting` | full section JSON without item | 200 / validation |

## Components usados
`page-header`, `confirm-destructive`, `save-feedback`, `helper-callout`.

## Navegação
Cancel → injections tab; success → injections tab.

## Teclado / a11y
Focus Cancel by default.

## Aceite de build
- [ ] Confirm focuses Cancel first
- [ ] PUT sends full remaining injections array
- [ ] Stale index shows not-found and does not PUT empty by mistake

## Explicitamente fora
Batch remove without per-item confirm; editing other Scripting fields here.

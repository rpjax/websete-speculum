# Scripts — injections list

## Job
Show configured `Scripting.Injections` and start add/edit flows; does not raw-edit JSON.

## Route / params / auth gate
- Route: `/admin/scripts?tab=injections`
- Auth: bearer

## Entrada
Scripts tab Injections.

## Layout

```
Tabs…
[ Add injection ]
List cards: source type · position · execution · rules summary · Edit
Empty-state → Add injection
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| add | button | Add injection | — | — | — | → injection-flow/new |
| edit | link | Edit | — | — | — | → flow with index |
| remove | button | Remove | Opens remove-confirm + apply | — | — | → [`remove-injection.md`](remove-injection.md) |

## Copy

- Add: `Add injection`
- Empty title: `No injections configured`
- Empty body: `Injections attach stored or remote scripts to matching pages at session launch.`
- Empty CTA: `Add injection`
- Card subtitle examples: `Stored · HeadEnd · Classic` / `Remote · BodyEnd · Module` (enum display names)

## Inteligência UX nesta view

- Primary path: Add or Edit.
- Helpers: empty-state; callout if Scripting section invalid after load.
- Hidden: full section JSON.
- Recovery: reload section.

## Path feliz
Load Scripting → render list → Add/Edit.

## Reveals
None.

## Estados
loading / empty / populated / error.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| Load | GET | `/api/configurations/Scripting` | — | `{ injections: [...] }` (camelCase) |

Edits apply via injection-flow review PUT.

## Components usados
`empty-state`, `helper-callout`, `status-pill` if apply pending local draft (optional).

## Navegação
→ `injection-flow` steps; → [`remove-injection.md`](remove-injection.md).

## Teclado / a11y
Add is primary.

## Aceite de build
- [ ] Cards summarize without JSON
- [ ] Empty CTA works
- [ ] Edit passes index

## Explicitamente fora
Applying on this screen without review flow.

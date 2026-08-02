# Injection flow — 04 Review and apply

## Job
Show a semantic summary of the injection, merge into Scripting.Injections, PUT apply, and return to list.

## Route
Step `review`.

## Entrada
Targets complete.

## Layout

```
step-wizard step 4 of 4
Summary card:
  Source: Stored “name” | Remote url
  Position / Execution
  Rules: Match all | N rules…
[ Back ] [ Apply injection ]

save-feedback on result
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| summary | readonly | — | Semantic diff vs previous if edit | — | — | |
| apply | button | Apply injection | Writes Scripting section | — | — | |
| back | button | Back | — | — | — | |

## Copy

- Apply: `Apply injection`
- Success toast: `Scripting configuration applied`
- Failure: server validation message (remote URL / missing stored id / rules)

## Inteligência UX nesta view

- Primary path: Apply.
- Helpers: `save-feedback`, summary as facilitator (no JSON wall).
- Reveal: optional “View JSON” collapsed for power users — **secondary only**.
- Recovery: stay on review with errors; fix via Back.

## Path feliz

1. GET current Scripting (fresh).
2. Insert or replace injection at index in array.
3. PUT `/api/configurations/Scripting`.
4. On success → injections list tab.
5. On failure → show feedback.

## Reveals
Optional raw JSON accordion.

## Estados
reviewing / applying / error / success-nav.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| Reload | GET | `/api/configurations/Scripting` | — | full section |
| Apply | PUT | `/api/configurations/Scripting` | full `ScriptingConfiguration` JSON | `{ ok, section }` or validation problem |

Validator enforces remote URL policy + stored id existence.

**Wire shape** (camelCase; string enums camelCase). One injection object:

```json
{
  "source": {
    "sourceType": "stored",
    "storedScriptId": "00000000-0000-0000-0000-000000000000",
    "remoteUrl": null
  },
  "position": "headEnd",
  "executionType": "classic",
  "targetRules": [ /* UrlMatchRule[] — see 03-targets */ ]
}
```

Remote variant: `"sourceType": "remote"`, `"storedScriptId": null`, `"remoteUrl": "https://cdn.example/app.js"`.

PUT body is the **entire** Scripting section: `{ "injections": [ ...merged array... ] }` (preserve other future section fields if GET returns them). Edit replaces `injections[index]`; new appends.

## Components usados
`step-wizard`, `save-feedback`, `reveal-panel`, `helper-callout`.

## Navegação
Success → `/admin/scripts?tab=injections`.

## Teclado / a11y
Apply is primary; confirm not needed (apply is reversible by further edits; still show clear summary).

## Aceite de build
- [ ] PUT sends full section with updated injections
- [ ] Stored missing id surfaces apply error
- [ ] Success lands on injections tab

## Explicitamente fora
Partial PATCH of one field without full section; applying other config sections.

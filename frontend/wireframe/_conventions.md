# DNA conventions (templates)

Every Sprint 1 **page** or **flow step** must use the page template with **no empty required sections**.  
Every **component** must use the component template.

Incomplete sections = incomplete DNA.

---

## Page / step template

```markdown
# {Name}

## Job
One sentence.

## Route / params / auth gate
- Route:
- Params:
- Auth: public | Bearer access | setup surface

## Entrada (pré-condições, deep-link)
When this view is reachable; query/hash deep-links.

## Layout (ASCII regiões)
Primary viewport ASCII. Mark above-the-fold.

## Inventory de controlos
| id | tipo | label | helper | default | required | validation |

## Copy (strings)
Titles, CTAs, empty, errors, confirms — exact intended English (product UI language: English unless noted).

## Inteligência UX nesta view
Primary path; helpers; reveals; NBA/empty; recovery.

## Path feliz (passos numerados)
1. …

## Reveals
What opens Sheet/Accordion/next step and how to dismiss.

## Estados (loading/empty/error/success/blocked)
UI for each.

## Dados / API
| ação UI | método | path | request | response usada |
Note if Presentation HTTP is still to be added over an existing domain service.

## Components usados
Links to `components/*.md`.

## Navegação (vem de / sai para)

## Teclado / a11y notas
Focus order, Escape, Enter submit, aria labels where non-obvious.

## Aceite de build
Checklist: implemented when…

## Explicitamente fora
What this view must not do.
```

---

## Component template

```markdown
# {Component}

## Papel
## Quando usar / não usar
## Variantes / props
## Estados
## Copy default
## A11y
## Usado por (páginas)
## Aceite de build
```

---

## Domain skeleton template (Sprint 2–3 folders)

Used for `configurations/`, `host-resources/`, `diagnostics/` until full DNA:

```markdown
# {Domain} — skeleton

## Jobs
## Routes
## APIs (existing + needed)
## Named flows (for later depth)
## Nav placement
## Explicitly deferred to Sprint N
```

---

## Language

- Wireframe authoring may mix PT/EN in meta notes.
- **Operator-facing copy** in inventory/Copy sections: **English** (matches current product UI).

## API JSON conventions (Refactor)

- Property names: **camelCase**.
- Enums: **camelCase strings** (`JsonStringEnumConverter` + camelCase policy), e.g. `headEnd`, `shared`, `any`.
- List pages: `{ items, total }` unless a page documents otherwise.
- Simple errors: `{ error: "code_or_message" }` with HTTP 4xx.
- Config apply validation: ASP.NET `ValidationProblem` (`errors` map by field/section) — map via `save-feedback` / `inline-validation`.
- Config GET `{section}`: raw section JSON body (or empty object defaults), not wrapped.

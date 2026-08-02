# Scripts module

## Job
One Admin place for **stored script library** and **Scripting injections policy** (config section), with internal division — not two top-level nav items.

## Route
`/admin/scripts` with `?tab=library` (default) | `?tab=injections`.

## Internal division

| Tab | DNA | Job |
|-----|-----|-----|
| Library | [`library.md`](library.md), [`upload-flow.md`](upload-flow.md) | Manage stored `.js` assets |
| Injections | [`injections.md`](injections.md), [`injection-flow/`](injection-flow/), [`remove-injection.md`](remove-injection.md) | Configure `Scripting.Injections` apply |

## Shared chrome on `/admin/scripts`

```
PageHeader: Scripts
Tabs: [ Library ] [ Injections ]
{tab outlet}
```

## Injection flow steps (`?step=`)

See [`injection-flow/README.md`](injection-flow/README.md) for draft persistence + abandon.

| step | DNA |
|------|-----|
| `source` | [`injection-flow/01-source.md`](injection-flow/01-source.md) |
| `placement` | [`injection-flow/02-placement.md`](injection-flow/02-placement.md) |
| `targets` | [`injection-flow/03-targets.md`](injection-flow/03-targets.md) |
| `review` | [`injection-flow/04-review-apply.md`](injection-flow/04-review-apply.md) |

Position enums: `HeadStart` \| `HeadEnd` \| `BodyStart` \| `BodyEnd` (JSON camelCase).

## Inteligência UX
- Empty library CTA → upload.
- Injections referencing missing stored id → repair via library upload or change source.
- Apply injections only after review step (add/edit) or remove-confirm apply.

## APIs
- Library: `/api/scripts` GET/POST/DELETE
- Injections: GET/PUT `/api/configurations/Scripting`

## Explicitamente fora
Lab script panels; remote fetch at Start (sidecar `src` only).

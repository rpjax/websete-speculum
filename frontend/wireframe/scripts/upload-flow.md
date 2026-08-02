# Scripts — upload flow

## Job
Upload a `.js` file into the stored script library with a display name.

## Route / params / auth gate
- Route: `/admin/scripts/upload`
- Auth: bearer

## Entrada
Library Upload CTA; injection source step “Upload first”.

## Layout

```
step-wizard single-step (or 2: file → review)
PageHeader: Upload script
[ Choose .js file ]
Name [____________] (prefill from filename)
Helper: max size 512 KB; `.js` only
[ Cancel ] [ Upload ]
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| file | file | Script file | `.js`, max **512 KB** (`ScriptService.MaxScriptBytes`) | — | yes | extension + size ≤ 524288 |
| name | text | Name | Shown in library and pickers | filename | yes | non-empty |
| submit | button | Upload | — | — | — | |
| cancel | button | Cancel | — | — | — | → library |

## Copy

- Title: `Upload script`
- Helper: `Classic or module scripts are stored as text. Max size 512 KB.`
- Errors: validation from API / `file` field messages (`Script file exceeds 524288 bytes.` / content exceeds)
- Success toast: `Script uploaded`

## Inteligência UX nesta view

- Primary path: choose file → name → Upload.
- Helpers: `helper-callout`, `inline-validation`.
- Prefill name from filename without extension.
- Recovery: fix file and retry.

## Path feliz

1. Select file.
2. Adjust name.
3. POST multipart.
4. Toast → library (or returnUrl to injection flow).

## Reveals
None.

## Estados
idle / uploading / error / success.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| Upload | POST | `/api/scripts` | multipart `file` + `name` | `ScriptListItem` / id |

## Components usados
`page-header`, `step-wizard` (optional single), `helper-callout`, `inline-validation`, `save-feedback`.

## Navegação
Query `returnUrl` back to injection source step when present.

## Teclado / a11y
File input labeled; announce upload progress.

## Aceite de build
- [ ] Rejects non-js / oversized (>512 KB) client-side before POST when possible
- [ ] Success returns to library or returnUrl
- [ ] Cancel discards

## Explicitamente fora
Remote URL upload; editing existing content (delete + re-upload V1).

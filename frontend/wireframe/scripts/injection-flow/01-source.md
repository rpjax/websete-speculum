# Injection flow — 01 Source

## Job
Choose Stored vs Remote source and identify the script (library id or public HTTPS URL).

## Route / params / auth gate
- Route: `/admin/scripts/injections/new` or `.../injections/:index/edit` step `source`
- Auth: bearer

## Entrada
Add/Edit injection.

## Layout

```
step-wizard: 1 Source · 2 Placement · 3 Targets · 4 Review
Source type: ( ) Stored  ( ) Remote

If Stored:
  [ Pick from library ▾ ] or [ Upload first → ]
If Remote:
  URL [ https://… ]
  helper SSRF rules

[ Back disabled ] [ Continue ]
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| sourceType | radio | Source type | Stored = library; Remote = script src URL | Stored | yes | enum |
| storedId | select | Stored script | From GET /api/scripts | — | if Stored | Guid non-empty |
| uploadLink | link | Upload first | — | — | — | returnUrl back |
| remoteUrl | url | Remote URL | Absolute http(s); public hosts only | — | if Remote | URL + apply-time policy |
| continue | button | Continue | — | — | — | |

## Copy

- Step title: `Source`
- Stored helper: `Content is snapshotted from the library at session start.`
- Remote helper: `The browser loads this URL as script src. Private/loopback hosts are rejected on apply.`
- Upload first: `Upload first`

## Inteligência UX nesta view

- Primary path: pick type + id/url → Continue.
- Helpers: `guided-preset` N/A; `helper-callout`; library empty → Upload first.
- Hidden: position/targets.
- Recovery: invalid URL client check.

## Path feliz
Select → Continue → step 02.

## Reveals
None.

## Estados
idle / library loading / empty library.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| List scripts | GET | `/api/scripts` | take reasonable | picker options |

Draft kept in client wizard state until review PUT.

## Components usados
`step-wizard`, `helper-callout`, `inline-validation`, `guided-preset` N/A.

## Navegação
→ `02-placement.md`. Cancel/abandon: see [`README.md`](README.md).

## Teclado / a11y
Radios labeled; Continue disabled until valid.

## Aceite de build
- [ ] Cannot continue without valid source
- [ ] Empty library shows Upload first
- [ ] Remote rejects non-http(s) client-side

## Explicitamente fora
Fetching remote bytes in Admin.

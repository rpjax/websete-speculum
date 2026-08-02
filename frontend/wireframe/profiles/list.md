# Profiles — list

## Job
Browse persisted browser profile identities (not Live sessions).

## Route / params / auth gate
- Route: `/admin/profiles`
- Query: `skip`, `take` (pagination)
- Auth: bearer

## Entrada
Nav Profiles; Home shortcut.

## Layout

```
PageHeader: Profiles
Table: ProfileId | Created | Last used | Open
Pagination
Empty-state
```

Counts (cookies / storage / history) live on **detail** only — list stays identity + timestamps.

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| table | table | — | — | — | — | |
| open | link | Open | — | — | — | |
| pager | pagination | — | — | take=50 | — | |

## Copy

- Title: `Profiles`
- Description: `Persisted browser identities and state summaries.`
- Empty title: `No profiles yet`
- Empty body: `Profiles are created when clients ensure an identity for browsing.`
- Columns: `Profile`, `Created`, `Last used`

## Inteligência UX nesta view

- Primary path: Open a profile.
- Helpers: `empty-state`.
- Hidden: raw StateJson.
- Recovery: retry on error.

## Path feliz
List → Open detail.

## Reveals
None.

## Estados
loading / empty / populated / error.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| List | GET | `/api/profiles` | `?skip&take` (default take 50, max 200) | `{ items: [{ profileId, createdAt, lastUsedAt }], total }` |

**Build note:** `IProfileService.ListProfilesAsync` exists. Expose Presentation GET `/api/profiles` if not mapped (prefer this over diagnostics-only path for Admin Profiles module). **Contract:** list DTO = `profileId`, `createdAt`, `lastUsedAt`, `total`; counts only on detail.

## Components usados
`page-header`, `empty-state`.

## Navegação
→ detail.

## Teclado / a11y
Sortable later; V1 unsorted by API order (Created desc).

## Aceite de build
- [ ] Pagination works with total
- [ ] Empty state correct
- [ ] No StateJson dump

## Explicitamente fora
Ensure/create profile from Admin; edit cookies table (diagnostics investigate later).

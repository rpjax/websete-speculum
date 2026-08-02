# Scripts — library

## Job
List and delete stored scripts; entry to upload flow.

## Route / params / auth gate
- Route: `/admin/scripts?tab=library`
- Query: `query`, `skip`, `take`
- Auth: bearer

## Entrada
Scripts module default tab.

## Layout

```
Tabs Library|Injections
[ Upload script ]     [ search-filter ]
Table: Name | Size | Updated | Delete
Empty-state → Upload
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| upload | button | Upload script | — | — | — | → upload-flow |
| search | search-filter | Search scripts | Name contains | "" | no | |
| delete | button | Delete | confirm-destructive inline/sheet | — | — | |
| row | text | name, size, dates | sha256 in reveal | — | — | |

## Copy

- Upload: `Upload script`
- Empty title: `No scripts in the library`
- Empty body: `Upload a .js file to use as a stored injection source.`
- Empty CTA: `Upload script`
- Delete confirm: `Delete “{name}”? Injections that reference it will fail apply until updated.`

## Inteligência UX nesta view

- Primary path: Upload or find script.
- Helpers: empty-state, search-filter, confirm-destructive.
- Hidden: file content preview (optional reveal later).
- Recovery: delete error toast.

## Path feliz
List → Upload or Delete.

## Reveals
Optional row expand: sha256, size bytes.

## Estados
loading / empty / populated / error.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| List | GET | `/api/scripts` | `query,skip,take` (default take 50, max 200) | `{ items: [{ id, name, sha256, size, uploadedAt, updatedAt }], total }` |
| Delete | DELETE | `/api/scripts/{scriptId}` | — | ok / error |

## Components usados
`page-header`, `empty-state`, `search-filter`, `confirm-destructive`, `status-pill` N/A.

## Navegação
→ upload-flow; Injections tab.

## Teclado / a11y
Upload is primary action in header.

## Aceite de build
- [ ] Empty CTA goes to upload
- [ ] Delete asks confirm with name
- [ ] Search calls API query

## Explicitamente fora
Editing script body in place; drafting injections (other tab).

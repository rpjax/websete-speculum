# Profile — detail

## Job
Show one profile’s summary counts and timestamps; offer delete path when safe.

## Route / params / auth gate
- Route: `/admin/profiles/:profileId`
- Auth: bearer

## Entrada
List; session detail link.

## Layout

```
PageHeader: Profile {id}
Created / Last used
Counts: cookies | localStorage | idb | history  (pills or definition list)

Actions: [ Delete profile ]   (secondary destructive)
If live: helper-callout blocked + link Sessions

Reveal: Raw identifiers only (no full state JSON wall)
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| delete | button | Delete profile | Opens confirm flow | — | — | disabled if live |
| liveCallout | helper-callout | — | Cannot delete while Live | — | — | |
| sessionsLink | link | View sessions | — | — | — | |

## Copy

- Title: `Profile`
- Delete: `Delete profile`
- Live block: `This profile has a live session. Stop the session before deleting.`
- Counts labels: `Cookies`, `Local storage`, `IndexedDB records`, `History entries`

## Inteligência UX nesta view

- Primary path: read summary; delete only if needed.
- Helpers: callout when live; confirm on delete route.
- Hidden: full state editor (diagnostics PUT state is separate Sprint 3).
- Recovery: not found empty-state.

## Path feliz
Load summary → done. Or Delete → confirm page.

## Reveals
Optional technical id panel (same as visible id — skip if redundant).

## Estados
loading / ready / live-blocked / not-found / error.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| Load | GET | `/api/profiles/{profileId}` | — | `profileId`, `createdAt`, `lastUsedAt`, `cookieCount`, `localStorageCount`, `idbRecordCount`, `historyCount` (+ optional `hasLiveSession`) |
| Live check | GET | `/api/sessions` | filter client-side by `profileId` | any item with matching profile |

Prefer summary including `hasLiveSession` boolean in Presentation DTO to avoid race — **contract:** detail response SHOULD include `hasLiveSession`. Until then, client may GET sessions and match `profileId`.

Existing alternate: `GET /api/admin/diagnostics/v1/profiles/{id}` — Admin Profiles module must use `/api/profiles/{id}` for domain clarity (add Presentation if missing).

## Components usados
`page-header`, `status-pill`, `helper-callout`, `confirm-destructive` (on next route).

## Navegação
→ `delete-confirm`; ← list; → sessions.

## Teclado / a11y
Delete not default focused.

## Aceite de build
- [ ] Counts render
- [ ] Delete disabled + callout when live
- [ ] Not found state

## Explicitamente fora
Replace state JSON editor; merge visualization of cookies.

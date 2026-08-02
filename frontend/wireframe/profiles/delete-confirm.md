# Profile — delete confirm

## Job
Irreversibly delete a persisted profile after explicit confirmation, only when no Live session exists.

## Route / params / auth gate
- Route: `/admin/profiles/:profileId/delete`
- Auth: bearer

## Entrada
Detail Delete button.

## Layout

```
PageHeader: Delete profile
confirm-destructive pattern:
  Warning copy
  Profile id shown
  [ Cancel ]  [ Delete permanently ]
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| cancel | button | Cancel | — | — | — | → detail |
| confirm | button | Delete permanently | Destructive | — | — | |

## Copy

- Title: `Delete profile`
- Body: `This removes persisted browser state for this identity. This cannot be undone.`
- Confirm: `Delete permanently`
- Error live: `Profile has a live session` → redirect detail with callout
- Success toast: `Profile deleted`

## Inteligência UX nesta view

- Primary path: Cancel (safe) or confirm delete.
- Helpers: `confirm-destructive`.
- Recovery: API failure message; live rejection.

## Path feliz

1. Confirm.
2. DELETE profile.
3. Toast → list.

## Reveals
None.

## Estados
idle / submitting / error.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| Delete | DELETE | `/api/profiles/{profileId}` | optional reason query | 200 / error |

Maps to `IProfileService.DeleteProfileAsync` (`ProfileDeletionReason.UserRequested`). Expose Presentation DELETE if missing.

## Components usados
`page-header`, `confirm-destructive`.

## Navegação
Cancel → detail; success → list.

## Teclado / a11y
Focus Cancel by default (safe default).

## Aceite de build
- [ ] Focus Cancel first
- [ ] Live error does not delete
- [ ] Success returns to list

## Explicitamente fora
Bulk delete; retention enforcer UI.

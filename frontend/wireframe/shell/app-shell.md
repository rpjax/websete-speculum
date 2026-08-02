# App shell

## Job
Provide consistent Admin chrome: nav by domain, user menu, command palette entry, toast host — without owning domain content.

## Route / params / auth gate
- Route: wraps all `/admin/*` except `/admin/login` and `/admin/session-expired` (those use minimal chrome: logo + title only).
- Auth: bearer for full shell; public for login/expired.

## Entrada
Any authenticated Admin route. Redirect unauthenticated → `/admin/login?returnUrl=…`.

## Layout (ASCII regiões)

```
┌──────────────────────────────────────────────────────────────┐
│ [☰] [S] Speculum Admin                    [User ▾] [Search] │
├──────────┬───────────────────────────────────────────────────┤
│ OPERATE  │                                                   │
│ Home     │                                                   │
│ Sessions │              {Outlet — page content}              │
│ Profiles │                                                   │
│ Scripts  │                                                   │
│ CONFIGURE│                                                   │
│ Config   │                                                   │
│ Host res │                                                   │
│ OBSERVE  │                                                   │
│ Diagnost.│                                                   │
│ ──────── │                                                   │
│ Speculum │                                                   │
└──────────┴───────────────────────────────────────────────────┘
│ Toasts (bottom-right, stacked)                               │
```

Brand chrome (until final logo): temporary `S` monogram + wordmark `Speculum` with muted `Admin`.  
Desktop rail (`w-56`): section labels Operate / Configure / Observe (same routes; grouping only); quiet Speculum wordmark in the rail footer.  
Mobile: collapse nav to Sheet via menu icon (same sections; no rail footer); Search trigger collapses to icon-only (shortcut still ⌘K / Ctrl+K).

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| nav.home | NavLink | Home | — | — | — | active on `/admin` exact |
| nav.sessions | NavLink | Sessions | Live sessions | — | — | |
| nav.profiles | NavLink | Profiles | Persisted identities | — | — | |
| nav.scripts | NavLink | Scripts | Library and injections | — | — | |
| nav.configurations | NavLink | Configurations | Engine sections | — | — | |
| nav.hostResources | NavLink | Host resources | Capacity / shm | — | — | |
| nav.diagnostics | NavLink | Diagnostics | Observe and govern | — | — | |
| user.menu | Menu | {username} | — | — | — | |
| user.changePassword | MenuItem | Change password | — | — | — | |
| user.signOut | MenuItem | Sign out | Clears tokens | — | — | |
| cmd.palette | Button | Search / actions | Opens command palette | — | — | shortcut ⌘K / Ctrl+K |

## Copy (strings)

- Product title in chrome: wordmark `Speculum` + muted `Admin` (temporary monogram `S` until brand asset)
- User chip: `{username}` from client-stored login identity; menu shows Operator role label
- Sign out confirm (optional light): none — sign out is safe; just clear tokens and go to login.

## Inteligência UX nesta view

- Primary path: navigate to a domain.
- Helpers: `command-palette`, toasts.
- Hidden: domain content until route selected.
- NBA: not in shell (Home owns NBA).
- Recovery: 401 → refresh → session-expired.

## Path feliz

1. Operator authenticates → shell mounts.
2. Clicks domain nav → outlet renders DNA page.
3. Optional ⌘K → jump or action.

## Reveals
- User menu.
- Mobile nav Sheet.
- Command palette overlay.

## Estados

| State | UI |
|-------|-----|
| loading auth | Shell skeleton; outlet spinner |
| authenticated | Full chrome |
| signing out | Disable nav briefly |

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| (optional) validate session | — | in-memory access token expiry | — | refresh if near expiry |
| sign out | local | — | clear tokens | — |

HTTP Bearer + 401 refresh: [`auth-session.md`](auth-session.md).

No dedicated “me” endpoint in V1; username from login form stored client-side at login time.

## Components usados
- [`command-palette`](../components/command-palette.md)
- [`toast-and-banners`](toast-and-banners.md) host
- [`auth-session`](auth-session.md) HTTP layer
- [`status-pill`](../components/status-pill.md) optional in header if global degraded (Diagnostics Sprint 3)

## Navegação
Vem de: login. Sai para: any admin route; login on sign-out.

## Teclado / a11y
- ⌘K / Ctrl+K opens palette.
- Skip link to main content.
- Nav `aria-current="page"`.

## Aceite de build
- [ ] All nav items match ia-map order
- [ ] Login/expired have no side nav
- [ ] Sign out clears tokens and lands on login
- [ ] Palette opens from button and shortcut

## Explicitamente fora
Domain page content; Lab; Motor; Diagnostics elevate UI (Sprint 3).

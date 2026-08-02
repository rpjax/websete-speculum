# Session expired

## Job
Explain that the access session ended and route the operator back to sign-in without losing the intended destination.

## Route / params / auth gate
- Route: `/admin/session-expired`
- Params: `returnUrl` optional
- Auth: public

## Entrada
Refresh failed after 401; explicit expiry.

## Layout

```
Speculum Admin
Title: Session expired
Body: Your sign-in is no longer valid. Sign in again to continue.
[ Sign in ]
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| continue | button | Sign in | — | — | — | |

## Copy
- Title: `Session expired`
- Body: `Your sign-in is no longer valid. Sign in again to continue.`
- CTA: `Sign in`

## Inteligência UX nesta view
Primary path: one CTA to login with returnUrl preserved.

## Path feliz
Click → `/admin/login?returnUrl=…`

## Reveals
None.

## Estados
Static.

## Dados / API
None (tokens already cleared).

## Components usados
`empty-state` pattern (informational).

## Navegação
→ login.

## Teclado / a11y
Focus CTA on mount.

## Aceite de build
- [ ] returnUrl preserved when safe
- [ ] No shell nav

## Explicitamente fora
Silent re-login without user action.

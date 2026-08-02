# Change password

## Job
Update the operator password and revoke existing tokens (re-login required).

## Route / params / auth gate
- Route: `/admin/change-password`
- Auth: bearer (always — even under lab bypass)

## Entrada
User menu; optional force banner when product detects first-login (client flag `mustChangePassword` if username/password were defaults — optional heuristic: show callout recommending change, not hard block in V1 unless product sets flag).

## Layout

```
PageHeader: Change password
Helper callout (if recommending)
Current password [____]
New password     [____]
Confirm new      [____]
[ Update password ]
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| current | password | Current password | — | "" | yes | non-empty |
| next | password | New password | At least 4 characters | "" | yes | length ≥ 4 |
| confirm | password | Confirm new password | — | "" | yes | equals next |
| submit | button | Update password | — | — | — | |
| cancel | link | Cancel | — | — | — | → `/admin` |

## Copy

- Title: `Change password`
- Callout: `If you are still using the install default, change it before exposing this control plane.`
- Success toast then redirect: `Password updated. Sign in again.`
- Errors: `invalid_credentials` → `Current password is incorrect.`; `password_too_short` → `New password is too short.`

## Inteligência UX nesta view

- Primary path: fill three fields → Update.
- Helpers: callout for default seed.
- Reveal: none.
- Recovery: incorrect current password.

## Path feliz

1. Submit.
2. POST change-password.
3. Clear tokens.
4. Toast + `/admin/login`.

## Reveals
None.

## Estados
idle / submitting / error / success-redirect.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| Update | POST | `/api/auth/change-password` | `{ currentPassword, newPassword }` | `{ ok: true }` |

Requires Bearer access token.

## Components usados
`page-header`, `helper-callout`, `inline-validation`, `save-feedback` (toast).

## Navegação
Vem de: user menu. Sai para: login after success; back to Home cancel (link `Cancel` → `/admin`).

## Teclado / a11y
Tab order current → new → confirm → submit.

## Aceite de build
- [ ] Success clears session and requires login
- [ ] Mismatch confirm shows client validation before API
- [ ] Works only with Bearer

## Explicitamente fora
Password strength meter beyond min length; multi-user admin.

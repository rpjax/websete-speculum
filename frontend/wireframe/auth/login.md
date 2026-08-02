# Login

## Job
Authenticate the operator and issue access + refresh tokens.

## Route / params / auth gate
- Route: `/admin/login`
- Params: `returnUrl` (optional, must be same-origin path starting with `/admin` or `/setup`)
- Auth: public

## Entrada
Unauthenticated user; sign-out; session-expired continue.

## Layout

```
┌─────────────────────────────────────┐
│           Speculum                  │
│           Admin sign-in             │
│  Username [________________]        │
│  Password [________________]        │
│  [ Sign in ]                        │
│  helper: Use your operator account  │
└─────────────────────────────────────┘
```

Minimal chrome (logo + title). No side nav.

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| username | text | Username | Operator account | "" | yes | non-empty trim |
| password | password | Password | — | "" | yes | non-empty |
| submit | button | Sign in | — | — | — | disabled while submitting |
| error | alert | — | API error | — | — | |

## Copy (strings)

- Title: `Admin sign-in`
- Helper under form: `Use your operator account. Default install uses admin until you change the password.`
- Error map: `invalid_credentials` → `Incorrect username or password.`
- Generic: `Sign-in failed. Try again.`

## Inteligência UX nesta view

- Primary path: enter credentials → Sign in.
- Helpers: callout about default seed (not a blocker).
- Hidden: refresh/change-password.
- Empty: N/A.
- Recovery: wrong password keeps fields; focus password.

## Path feliz

1. Enter username/password.
2. POST login.
3. Store `accessToken`, `refreshToken`, `accessExpiresAt`, `username`.
4. Navigate to `returnUrl` or `/admin`.

## Reveals
None.

## Estados

| State | UI |
|-------|-----|
| idle | Form enabled |
| submitting | Button spinner; inputs disabled |
| error | Alert above button |
| success | Redirect |

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| Sign in | POST | `/api/auth/login` | `{ username, password }` | `accessToken`, `accessExpiresAt`, `refreshToken`, `refreshExpiresAt` |

401 body: `{ error: "invalid_credentials" | … }`. Refresh failures: `{ error: "invalid_refresh_token" }` (see auth-session).

## Components usados
- [`helper-callout`](../components/helper-callout.md)
- [`inline-validation`](../components/inline-validation.md)

## Navegação
Vem de: session-expired, sign-out, deep link. Sai para: returnUrl or `/admin`. If `operational === false` after login, Home still loads but NBA points to Setup (do not force redirect unless product prefers — **contract: land on `/admin`, Home shows NBA**).

## Teclado / a11y
Enter submits; autocomplete username/current-password.

## Aceite de build
- [ ] Successful login stores tokens and lands correctly
- [ ] Invalid credentials show mapped copy
- [ ] returnUrl open-redirect safe (path allowlist)

## Explicitamente fora
SSO; register; forgot-password; API key.

# Auth session (client)

## Job
Attach Bearer tokens to Admin API calls, refresh once on 401, and land on session-expired when refresh fails — without each page inventing its own policy.

## Route / params / auth gate
Not a route. Lives in Admin app bootstrap / HTTP client (shell companion).

## Entrada
Any authenticated Admin fetch after login.

## Layout
N/A (invisible). Failure surfaces via [`session-expired.md`](../auth/session-expired.md) or toast.

## Inventory de controlos
None (infrastructure).

## Copy
- Refresh failure → navigate session-expired (no toast spam).
- Optional toast only if refresh succeeds mid-action and request retries: none required.

## Inteligência UX nesta view
- Zero busywork: one silent refresh attempt.
- Recovery: session-expired → Sign in with `returnUrl`.

## Path feliz

1. Request with `Authorization: Bearer {accessToken}`.
2. If 401 and refreshToken present and not already refreshing: POST refresh once; update stored tokens; retry original once.
3. If refresh fails or second 401: clear tokens → `/admin/session-expired?returnUrl=…`.

## Reveals
None.

## Estados

| State | Behavior |
|-------|----------|
| has access | Attach Bearer |
| refreshing | Queue concurrent 401s behind one refresh |
| expired | Clear storage; redirect |

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| Refresh | POST | `/api/auth/refresh` | `{ refreshToken }` | `accessToken`, `accessExpiresAt`, `refreshToken`, `refreshExpiresAt` |

401 body: `{ error: "invalid_refresh_token" }` → treat as hard expiry (clear + session-expired).

Storage contract (same as login): `accessToken`, `refreshToken`, `accessExpiresAt`, `refreshExpiresAt`, `username` in memory + `sessionStorage` (not `localStorage` for access).

## Components usados
None; used by shell HTTP layer.

## Navegação
→ session-expired on hard fail.

## Teclado / a11y
N/A.

## Aceite de build
- [ ] Authenticated calls send Bearer
- [ ] Single-flight refresh on concurrent 401s
- [ ] Failed refresh clears tokens and preserves safe returnUrl
- [ ] Public routes (login, session-expired, client-config) do not attach stale Bearer incorrectly

## Explicitamente fora
Cookie sessions; SSO; storing access token in localStorage.

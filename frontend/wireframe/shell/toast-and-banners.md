# Toasts and banners

## Job
Surface transient success/error and optional persistent setup banners without blocking the page.

## Route
Hosted by shell (toasts + readiness banner on bearer routes). Setup gate also shows its own status (not duplicate banner required on `/setup`).

## Entrada
Any page calling toast API; Home/Setup for readiness banner.

## Layout
Toasts: bottom-right stack, max 3 visible.  
Banner: full-width under header on **any bearer Admin route** when `operational === false` (not only Home).

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| toast | alert | (dynamic) | Auto-dismiss 5s success; error sticky until dismiss | — | — | |
| banner.setup | banner | Setup required | Link to `/setup` | — | — | shown if not operational |

## Copy
- Success default: `Saved`
- Error default: `Something went wrong` + detail from API `error` field when present
- Banner: `This environment is not ready to start sessions.` CTA: `Continue setup`

## Inteligência UX nesta view
Primary path: glance and continue. Errors include recovery hint when page supplies one.

## Path feliz
Action succeeds → green toast → auto clear.

## Reveals
None.

## Estados
success / error / info toasts; banner visible/hidden.

## Dados / API
Consumes caller-provided message; banner uses `GET /api/configurations/status` or client-config `operational`.

## Components usados
Primitive toast/banner only.

## Navegação
Banner CTA → `/setup`.

## Teclado / a11y
role=status for success; role=alert for error; dismiss button labeled `Dismiss`.

## Aceite de build
- [ ] Success auto-dismisses
- [ ] Error remains until dismissed
- [ ] Banner only when not operational

## Explicitamente fora
Modal dialogs (use confirm-destructive); inline field validation (use inline-validation).

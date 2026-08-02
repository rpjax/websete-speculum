# Readiness gate

## Job
Explain that sessions cannot start until mandatory configuration is complete, and send the operator into the guided wizard.

## Route / params / auth gate
- Route: `/setup`
- Auth: setup surface — readable with public client-config; applying config in next step needs bearer (prompt login if missing).

## Entrada
Home NBA; redirect when Motor/client detects `operational === false` (Admin shell may soft-banner instead of hard redirect).

## Layout

```
PageHeader: Setup
Status pill Not ready
Missing sections (chips)
Helper: Why setup exists
[ Start guided configuration ]
Link: Sign in (if no token) · Back to Home (if token)
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| missing | chips | Missing | From API | — | — | |
| start | button | Start guided configuration | — | — | — | |
| signIn | link | Sign in to apply changes | — | — | — | if !token |

## Copy

- Title: `Setup`
- Body: `Speculum will not start live sessions until mandatory engine sections are valid.`
- CTA: `Start guided configuration`
- Sign-in hint: `You need to sign in before changes can be applied.`

## Inteligência UX nesta view

- Primary path: Start guided configuration.
- Helpers: callout + status pill.
- Reveal: none.
- Recovery: if already operational → message `Setup complete` + CTA Home.

## Path feliz

1. Load client-config/status.
2. If operational → redirect `/admin`.
3. Else show missing → Start → `/setup/configure`.

## Reveals
None.

## Estados
loading / not-ready / ready-redirect / error.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| Load | GET | `/api/public/client-config` | — | `operational`, `missing` |

## Components usados
`page-header`, `status-pill`, `next-best-action`, `helper-callout`.

## Navegação
→ `/setup/configure`; `/admin/login`; `/admin`.

## Teclado / a11y
Focus primary CTA.

## Aceite de build
- [ ] Operational short-circuits to Home
- [ ] Missing list matches API

## Explicitamente fora
Editing sections on this page (wizard next).

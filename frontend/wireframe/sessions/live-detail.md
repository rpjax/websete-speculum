# Live session — detail

## Job
Inspect one Live session identity and high-level status; reveal deeper facts on demand.

## Route / params / auth gate
- Route: `/admin/sessions/:sessionId`
- Auth: bearer

## Entrada
From list; deep link.

## Layout

```
PageHeader: Session {shortId}
            Profile {profileId}   [ View profile ]

Status pills: Connection Open|Closed · JsBridge on|off
Uptime: {formatted}

Primary: identity summary (ids, uptime, connection)

[ Reveal: Technical details ]

Back to sessions
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| profileLink | link | View profile | — | — | — | `/admin/profiles/:profileId` |
| tech | reveal-panel | Technical details | Snapshot extras / optional status poll | collapsed | — | |
| back | link | Back to sessions | — | — | — | |

## Copy

- Not found: `This session is not live or was not found.`
- CTA: `Back to sessions`
- Reveal title: `Technical details`
- Connection open: `Open` / closed: `Closed`
- JsBridge: `JsBridge on` / `JsBridge off`

## Inteligência UX nesta view

- Primary path: confirm identity + jump to profile.
- Helpers: `reveal-panel`, `status-pill`.
- Hidden: frame metrics stream, input pipes, harness posts (Lab).
- Recovery: 404 empty-state.

## Path feliz

1. GET session by id (or find in list payload).
2. Show summary.
3. Optional reveal tech.
4. Optional view profile.

## Reveals
Technical details panel — show `jsBridgeEnabled`, raw `uptimeMs`, `connectionOpen`. Optional later: sidecar `GetStatus` fields (`url`, `width`/`height`, `fps`) **only if** Presentation exposes them on this GET; do not call Lab harness routes from Admin.

## Estados
loading / ready / not-found / error.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| Load | GET | `/api/sessions/{sessionId}` | — | same fields as list item (`LiveSessionTelemetrySnapshot`) |

404 when not in live registry. Same Presentation gap note as list.

## Components usados
`page-header`, `status-pill`, `reveal-panel`, `empty-state`.

## Navegação
← list; → profile.

## Teclado / a11y
Reveal toggled by button.

## Aceite de build
- [ ] Not-found state
- [ ] Profile link works when profileId present
- [ ] Tech details collapsed by default
- [ ] No invented `state` enum

## Explicitamente fora
Stop session; resize/input/evaluate; watch JPEG stream (Motor).

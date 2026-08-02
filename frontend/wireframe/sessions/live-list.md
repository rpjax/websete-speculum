# Live sessions — list

## Job
Show currently Live sessions so the operator can open one for detail — not start/stop from a god console.

## Route / params / auth gate
- Route: `/admin/sessions`
- Query: `q` optional filter (session id / profile id substring, client-side or server)
- Auth: bearer

## Entrada
Nav Sessions; Home shortcut.

## Layout

```
PageHeader: Sessions
            Live remote browser sessions
[ search-filter ]

Table or cards:
  SessionId | ProfileId | Connection | Uptime | Open →

Empty-state when none
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| search | search-filter | Filter sessions | Session or profile id | "" | no | |
| row.open | link | Open | — | — | — | → detail |
| empty | empty-state | — | — | — | — | |

## Copy

- Title: `Sessions`
- Description: `Live remote browser sessions attached to this control plane.`
- Empty title: `No live sessions`
- Empty body: `This is normal when nobody is browsing. Sessions appear here while they are Live.`
- Empty CTA: none (sessions start from Motor — not Admin V1)
- Columns: `Session`, `Profile`, `Connection`, `Uptime`

## Inteligência UX nesta view

- Primary path: scan list → Open.
- Helpers: `search-filter`, `empty-state`, `status-pill` on connection (`Open` / `Closed`).
- Hidden: input harness, evaluate, resize (Lab / Motor).
- NBA: empty explains normality — not an error.
- Recovery: load error → Retry.

## Path feliz

1. GET live sessions.
2. Render rows.
3. Click Open → `/admin/sessions/:sessionId`.

## Reveals
None on list.

## Estados
loading / empty / populated / error.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| List | GET | `/api/sessions` | optional `?q&skip&take` | `items[]` |

**Item contract** (Presentation over `ILiveSessionService.ListSnapshots()` → `LiveSessionTelemetrySnapshot`):

| field | type | UI |
|-------|------|-----|
| `sessionId` | guid | column + link |
| `profileId` | guid | column + optional link to profile |
| `jsBridgeEnabled` | bool | reveal or secondary |
| `connectionOpen` | bool | status-pill Open/Closed |
| `uptimeMs` | long | format as duration |

Do **not** invent a `state: "Live"` enum — presence in this list means Live.  
**Build note:** add thin Presentation GET if missing; do not invent hub-only hacks.

## Components usados
`page-header`, `search-filter`, `empty-state`, `status-pill`.

## Navegação
→ detail; ← Home.

## Teclado / a11y
Table with row links; filter debounced 200ms.

## Aceite de build
- [ ] Empty copy is non-alarming
- [ ] Filter narrows rows
- [ ] Columns match snapshot fields
- [ ] Open navigates with id

## Explicitamente fora
Start/stop session; attach Motor; RoundRobin controls; lab input injection.

# Operator home

## Job
Answer: is the environment ready to run sessions, and what should the operator do next? Offer a dense overview (status strip, live counts, config tiles, shortcuts) — not a telemetry dashboard.

## Route / params / auth gate
- Route: `/admin`
- Auth: bearer

## Entrada
Post-login default landing.

## Layout

```
PageHeader: Home · Operator control plane · [Refresh]

┌ Banner (only if !operational) ─────────────────────────────┐
│ Mandatory configuration incomplete · [Continue setup]       │
└────────────────────────────────────────────────────────────┘

┌ Stat cards (row) ──────────────────────────────────────────┐
│ Ready/Not ready │ Live sessions (n) │ Profiles shortcut     │
│ Config sections ready count                               │
└────────────────────────────────────────────────────────────┘

┌ Attention (only if missing[]) ─────────────────────────────┐
│ Missing chips → /admin/configurations/:section             │
│ NBA: Continue setup → /setup                               │
└────────────────────────────────────────────────────────────┘

┌ Live strip ──────────────┐ ┌ Config tiles ────────────────┐
│ Up to 5 live sessions    │ │ Each engine section Ready/   │
│ id chip · uptime · Open  │ │ Missing · Open section       │
│ empty: “No live sessions │ │ Scripting → Scripts inject.  │
│ — normal when idle”      │ │                              │
└──────────────────────────┘ └──────────────────────────────┘

Shortcuts (secondary grid)
Sessions · Profiles · Scripts · Configurations · Host · Diagnostics
```

No charts, no timeline, no JSON walls. Stat values come only from Bearer APIs below.

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| refresh | button | Refresh | Reloads status + sessions | — | — | |
| banner | helper-callout | Not ready banner | Only if !operational | — | — | |
| stat.ready | stat-card | Ready / Not ready | From configurations status | — | — | |
| stat.live | stat-card | Live sessions | Count from GET sessions | — | — | link `/admin/sessions` |
| attention.missing | chips | Missing sections | PascalCase names | — | — | hide if ready |
| nba | next-best-action | Continue setup | Opens `/setup` | — | — | show if !operational |
| live.strip | list | Live sessions | Up to 5 rows | — | — | empty coaching |
| config.tiles | tiles | Engine sections | Ready/Missing per section | — | — | |
| shortcut.* | link-card | Domain shortcuts | One-line job each | — | — | |

## Copy

- Title: `Home`
- Description: `Operator control plane for Speculum.`
- Ready: `Ready to start sessions.`
- Not ready: `Mandatory configuration is incomplete.`
- NBA title: `Continue setup`
- NBA body: `Complete missing sections so sessions can start.`
- NBA CTA: `Open setup`
- Live empty: `No live sessions — normal when idle.`
- Live open: `Open`
- Shortcuts:
  - Sessions — `Inspect live sessions`
  - Profiles — `Persisted browser identities`
  - Scripts — `Library and page injections`
  - Configurations — `Engine sections`
  - Host resources — `Capacity and shm`
  - Diagnostics — `Observe and govern`
  (palette also: Diagnostics resources, Diagnostics signals, Diagnostics reports)

## Inteligência UX nesta view

- Primary path: if not ready → NBA; if ready → live strip or shortcut.
- Helpers: `status-pill`, `next-best-action`, `helper-callout`, `empty-state`, `stat-card`, `data-card`, `id-chip`.
- Hidden: detailed config editors, diagnostics charts, raw JSON.
- Recovery: status/sessions fetch error → retry + callout.

## Path feliz

1. GET `/api/configurations/status` + GET `/api/sessions` (parallel).
2. Render banner/stats/attention/live/config tiles/shortcuts.
3. Operator clicks NBA, missing chip, live Open, or shortcut.

## Reveals
None on Home (keep flat).

## Estados

| State | UI |
|-------|-----|
| loading | Skeleton matching final composition |
| ready | Green ready card; NBA hidden; live + tiles |
| not ready | Amber banner + NBA + missing chips |
| error | Callout + Retry |

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| Load status | GET | `/api/configurations/status` | — | `operational`, `missing[]` |
| Load sessions | GET | `/api/sessions` | — | `items[]` (sessionId, profileId, uptimeMs, connectionOpen) |

Prefer bearer when authenticated. Do not invent dropped-events or health-score without an API.

## Components usados
`page-header`, `status-pill`, `next-best-action`, `helper-callout`, `empty-state`, `stat-card`, `data-card`, `id-chip`, `meta-row`.

## Navegação
→ `/setup`, `/admin/configurations/:section`, `/admin/sessions/:id`, domain shortcuts.

## Teclado / a11y
Shortcuts and tiles as links; NBA is a link/button.

## Aceite de build
- [ ] Not-ready shows missing names and NBA
- [ ] Ready hides NBA
- [ ] Live strip uses real session list (or coaching empty)
- [ ] No god-dashboard / fake gauges

## Explicitamente fora
Telemetry charts; script editors; config forms; diagnostics elevate/recover UI.

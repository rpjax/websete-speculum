# Command palette

## Job
Jump to any Admin domain/page or run a small set of safe global actions without hunting the nav.

## Route / params / auth gate
Overlay on bearer shell. Not a route.

## Entrada
⌘K / Ctrl+K or header button.

## Layout

```
┌─ Command palette ─────────────────────┐
│ [ Filter commands…                 ]  │
│ Go to                                 │
│   Home                                │
│   Sessions                            │
│   …                                   │
│ Actions                               │
│   Change password                     │
│   Sign out                            │
└───────────────────────────────────────┘
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| filter | text | Filter commands… | Type to filter | "" | no | — |
| results | listbox | — | Grouped Go to / Actions | — | — | |

## Copy
- Placeholder: `Filter commands…`
- Group: `Go to` / `Actions`
- Empty filter results: `No matching commands`

## Inteligência UX nesta view
Primary path: type 2–3 chars → Enter. Helpers: self. Hidden: destructive diagnostics actions (Sprint 3 may add “Recover” when API exists).

## Path feliz
1. Open palette.
2. Filter or arrow to “Sessions”.
3. Enter → navigate and close.

## Reveals
Palette itself is a reveal; Escape closes.

## Estados
Open / closed / no matches.

## Dados / API
Navigation only; Sign out local; Change password → route.

Go-to must include: Home, Sessions, Profiles, Scripts, Configurations, Host resources, Diagnostics, Diagnostics resources (`/admin/diagnostics/resources`), Diagnostics signals, Diagnostics reports, Change password.

## Components usados
Self (also listed under `components/command-palette.md` as the shared DNA).

## Navegação
Targets from ia-map Go-to list.

## Teclado / a11y
Focus trap; Escape closes; aria-modal; listbox pattern.

## Aceite de build
- [ ] Shortcut works
- [ ] All Go-to domains present
- [ ] Escape restores focus to trigger

## Explicitamente fora
Creating sessions; applying config; Lab commands.

# command-palette

## Papel
Jump to any Admin domain/page or run a small set of safe global actions without hunting the nav.

## Quando usar / não usar
Use: one instance in Admin shell.  
Don’t: domain-specific destructive applies (config apply, delete profile) — those stay on their pages.

## Variantes / props

| prop | type | notes |
|------|------|-------|
| `open` | boolean | Controlled |
| `onOpenChange` | `(open: boolean) => void` | |
| `groups` | `{ id, label, items: { id, label, keywords?, action }[] }[]` | `Go to` + `Actions` |
| `placeholder` | string | default `Filter commands…` |

Default Go-to targets (from ia-map): Home, Sessions, Profiles, Scripts, Configurations, Host resources, Diagnostics, Diagnostics resources, Diagnostics signals, Diagnostics reports, Change password.  
Default Actions: Sign out (local clear). Sprint 3 may add Recover when API exists.

Page-level layout / path feliz: [`../shell/command-palette.md`](../shell/command-palette.md).

## Estados
Closed / open / no matches / navigating.

## Copy default
- Placeholder: `Filter commands…`
- Groups: `Go to` / `Actions`
- Empty: `No matching commands`

## A11y
Focus trap; Escape closes; `role="dialog"` + listbox; restore focus to trigger.

## Usado por
`shell/app-shell`, `shell/command-palette`.

## Aceite de build
- [ ] ⌘K / Ctrl+K and header button open it
- [ ] All Go-to domains present
- [ ] Escape restores focus
- [ ] Sign out clears tokens

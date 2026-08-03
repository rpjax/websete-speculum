# Nav

## Job
Domain navigation for Admin — one entry per motor domain module.

## Route / params / auth gate
Part of app shell; bearer.

## Entrada
Shell mounted.

## Layout
Vertical list in left rail (desktop, `w-56`); Sheet list (mobile).

Grouped under subtle section labels (routes unchanged):

| Section | Items |
|---------|--------|
| Operate | Home, Sessions, Profiles, Scripts |
| Configure | Configurations, Host resources |
| Diagnostics | Health, Resources, Signals, Timeline, Investigate, Reports, Governance |

`/admin/diagnostics` (hub) redirects to Health — Diagnostics is a **section**, not a single dispatch page.

Desktop rail footer: quiet “Speculum / Operator console” wordmark (no version stub unless product exposes one).

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| item | NavLink | (see app-shell) | short domain hint | — | — | exact/prefix active rules; `aria-current="page"` when active |

Active rules:

- Home: `/admin` exact
- Sessions: `/admin/sessions` prefix
- Profiles: `/admin/profiles` prefix
- Scripts: `/admin/scripts` prefix
- Configurations: `/admin/configurations` prefix
- Host resources: `/admin/host-resources` prefix
- Health: `/admin/diagnostics/health` prefix
- Resources: `/admin/diagnostics/resources` prefix
- Signals: `/admin/diagnostics/signals` prefix
- Timeline: `/admin/diagnostics/timeline` prefix
- Investigate: `/admin/diagnostics/investigate` prefix
- Reports: `/admin/diagnostics/reports` prefix
- Governance: `/admin/diagnostics/governance` prefix

## Copy
Labels as in app-shell inventory (English).

## Inteligência UX nesta view
Primary path: pick a domain. No nested mega-menus. Scripts is one item (internal tabs inside module).

## Path feliz
Click → navigate.

## Reveals
None beyond mobile Sheet.

## Estados
Active / inactive / focus.

## Dados / API
None.

## Components usados
- `AdminSidebar` / `AdminNav` (Refactor web shell) — shared rail + mobile Sheet list
- NavLink primitives; lucide icons

## Navegação
See ia-map.

## Teclado / a11y
Arrow keys within nav list; Enter activates.

## Aceite de build
- [ ] Seven domain links + Home
- [ ] Active state correct for nested routes
- [ ] Scripts single nav item

## Explicitamente fora
Lab link; Motor link; per-section config submenu (use Configurations hub).

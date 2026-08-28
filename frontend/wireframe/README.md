# Speculum Admin — Wireframe DNA

This folder is the **build-contract** for the new Admin frontend. Implement from these files + Refactor APIs. Do **not** invent routes, copy, fields, flows, or pages.

**Legacy Admin UI** (`web` admin pages) is discarded for this rebuild. Motor (`/`) and Lab are separate surfaces.

## Read first

1. [`_principles.md`](_principles.md) — how we structure the wireframe (constitution)
2. [`_ux-intelligence.md`](_ux-intelligence.md) — how the UI helps the operator
3. [`_conventions.md`](_conventions.md) — DNA template every page/component must fill
4. [`ia-map.md`](ia-map.md) — routes, auth gates, deep-links

## Domain map

| Domain | Folder | Primary routes |
|--------|--------|----------------|
| Shell | [`shell/`](shell/) | chrome (all `/admin/*`) |
| Auth | [`auth/`](auth/) | `/admin/login`, `/admin/change-password` |
| Home | [`home/`](home/) | `/admin` |
| Setup | [`setup/`](setup/) | `/setup` |
| Sessions | [`sessions/`](sessions/) | `/admin/sessions`, `/admin/sessions/:sessionId` |
| Profiles | [`profiles/`](profiles/) | `/admin/profiles`, `/admin/profiles/:profileId` |
| Scripts | [`scripts/`](scripts/) | `/admin/scripts` (library \| injections) |
| Configurations | [`configurations/`](configurations/) | `/admin/configurations` (Sprint 2 depth) |
| Host resources | [`host-resources/`](host-resources/) | `/admin/host-resources` (Sprint 2 depth) |
| Diagnostics | [`diagnostics/`](diagnostics/) | `/admin/diagnostics/...` (Resources/Signals/Reports DNA + health/timeline/govern) |
| Components | [`components/`](components/) | shared DNA helpers |

## Golden rule

If an implementer must guess empty states, endpoints, labels, or next steps, the wireframe is incomplete.

## Sprint 1 status

- Constitution + template + `ia-map` published.
- Auth / Home / Setup / Sessions / Profiles / Scripts + shell + `components/` in DNA depth.
- Configurations / Host resources = skeletons → viewport DNA in Sprint 2; Diagnostics Resources/Signals/Reports DNA published (health/timeline/govern still deepening).
- Presentation gaps for Profiles/Sessions list HTTP are called out in `ia-map.md` (thin endpoints over existing services).

## How to build from DNA

1. Read constitution files above.
2. Implement shell + `auth-session` before domain pages.
3. For each page: follow that file’s inventory, copy, states, API table — no inventing.
4. Config JSON: camelCase + camelCase string enums (see Scripts injection review DNA).

## Stack when building (not in this folder)

- React 19 + Vite + Tailwind v4 + **shadcn only** — see `docs/frontend-standards.md`
- Vocabulary: Speculum / Sessions / Profiles — see `docs/naming.md`

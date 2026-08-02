# UX intelligence (constitution)

Complements [`_principles.md`](_principles.md): principles = *how we structure the wireframe*; this file = *how the UI helps the operator*.

Law: `docs/frontend-standards.md`, recipes: `docs/frontend-patterns.md`.

## UX principles (every page)

1. **Primary path first** — default viewport only what finishes the current job.
2. **Reveal on need** — advanced / metrics / edge cases via next step, Sheet, drill-down, expand — never all-at-once.
3. **Self-explanatory** — label + helper (“what / why / next”) replace manuals.
4. **Zero busywork** — sensible defaults, API prefills, one-click safe actions; confirm only for destructive / irreversible work.
5. **Multi-step > god page** — complexity becomes `*Flow` / steps with progress + safe back.
6. **Next best action (NBA)** — Home / Setup / empty states say *what to do now* with a semantic CTA.
7. **Facilitators > bare forms** — presets, wizards, domain pickers, review-before-apply.
8. **Recovery paths** — error states include a repair action (“Recover”, “Reopen step 2”, “Go to Navigation”).

## Helper catalog

Each helper has a DNA file under [`components/`](components/).

| Helper | Role |
|--------|------|
| `step-wizard` | Progress, next/back, safe abandon |
| `next-best-action` | “Do this now” CTA (ready / missing) |
| `helper-callout` | Why / attention without blocking the path |
| `reveal-panel` | On-demand detail (Sheet / Accordion) |
| `empty-state` | No data + CTA into the right flow |
| `confirm-destructive` | Irreversible only; explicit copy |
| `save-feedback` | Applied / field-path validation / partial |
| `command-palette` | Go to domain / fire common action |
| `status-pill` | Ready / degraded / live / missing section |
| `search-filter` | Semantic filter (not raw JSON) |
| `guided-preset` | Domain shortcuts (match-all, HeadStart, …) |
| `inline-validation` | Field error + how to fix |
| `page-header` | Title + description + page actions |

## Required section on every page

```markdown
## Inteligência UX nesta view
- Primary path (one dominant action)
- Helpers used and *when*
- What stays hidden until reveal / next step
- NBA / empty CTA if the operator arrives blank
- Recovery if apply/API fails
```

## Domain intelligence examples (Sprint 1)

- **Home:** ready status + NBA (“Complete Navigation”) + domain shortcuts — not a dense dashboard.
- **Setup:** wizard per missing section — not one mega-form.
- **Sessions list:** empty = “No live sessions — normal when idle”; detail = metrics in reveal.
- **Profiles:** delete only via confirm; Live blocks with explanation + link to Sessions.
- **Scripts library:** empty → upload-flow; injection without script → “Upload first” on source step.
- **Injection flow:** position/target presets; review shows semantic summary before apply.
- **Auth change-password:** if default seed password, callout that prod must change it.
- **Diagnostics Resources:** machine-first series (CPU/mem/disk) + live strip; overlays and raw samples via reveal; not a TelemetryMonitor god page.
- **Diagnostics Signals:** actionable active leaks/anomalies with jump to Resources `chartHint`; empty = healthy coaching.
- **Diagnostics Reports:** wizard kind → period → review; detail is narrative chapters, not JSON dump.

## Anti-patterns (banned)

- God page / god component
- JSON / config wall as primary UI
- Empty shell without CTA
- Generic CRUD without facilitators
- Confirm on routine save
- Lab / Motor mixed into Admin chrome
- Page without API mapping
- Copy left as “TODO” / lorem

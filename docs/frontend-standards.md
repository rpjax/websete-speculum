# Speculum Frontend Standards (mandatory)

**Audience:** humans and AI agents changing `web/`.  
**Status:** constitution — not optional guidance.  
**If this conflicts with convenience, this wins.**

Read this **before** any UI, UX, layout, or React feature work under `web/`. Recipes live in [frontend-patterns.md](frontend-patterns.md); this file defines the **non-negotiable contract**. Backend/test/CI law remains [engineering-standards.md](engineering-standards.md).

---

## 0. Agent preamble (read first)

| Step | Document |
|------|----------|
| 1 | This file |
| 2 | [frontend-patterns.md](frontend-patterns.md) — approved UX recipes |
| 3 | [../web/README.md](../web/README.md) — routes, structure, motor/admin surfaces |
| 4 | [naming.md](naming.md) — Speculum / Motor / W7S vocabulary (motor feature folders) |
| 5 | [engineering-standards.md](engineering-standards.md) — still applies (tests, CI, wire, V1) |
| 6 | Cursor injects a short summary when editing `web/`: [../.cursor/rules/speculum-frontend-standards.mdc](../.cursor/rules/speculum-frontend-standards.mdc) |

**Hard bans before you type:**

- Do not introduce a second UI kit (MUI, Fluent, Ant, Chakra, custom look-alikes). **shadcn only.**
- Do not ship god pages or god components — split into flows, sub-routes, and composed widgets.
- Do not present complex data or procedures as unstructured text/JSON walls as the primary UI.
- Do not saturate the default viewport — use **revealing UI** (primary path first; detail on progress/interaction).
- Do not ship empty-shell screens that require an external manual to operate.
- Do not invent bare forms when a flow or facilitator already exists in [frontend-patterns.md](frontend-patterns.md).
- Do not add raw hex colors in TSX outside `@theme` tokens (Motor canvas chrome is the sole documented exception — see patterns).

---

## 1. Surfaces and product jobs

One SPA: [`web/`](../web/) (`speculum-web`). Three surfaces, different density:

| Surface | Routes | Job | Density |
|---------|--------|-----|---------|
| **Motor** | `/` | Immersive remote browser (canvas + chrome) | Minimal chrome; reveal connection/status detail on need |
| **Setup** | `/setup` | Guided first-run / not-ready status | Wizard / one job per step |
| **Admin** | `/admin/*` | Operator control plane | Revealing forms + rich visualization; drill-down over mega-pages |

**Stack lock (non-negotiable):**

| Layer | Choice |
|-------|--------|
| Framework | React 19 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS v4 + `@theme` tokens in `web/src/index.css` |
| Primitives | **shadcn-style** under `web/src/components/ui/` (Radix + CVA + `cn()`) |
| Icons | `lucide-react` |
| Routing | `react-router-dom` |
| Imports | `@/` → `src/*` |
| Features | `features/motor/{live,mapping}`, `features/admin`, `features/setup` |

### 1.1 shadcn constitution (visual consistency)

- **Only** hand-maintained shadcn-style primitives in `components/ui/`.
- New UI need → **add or extend** a shadcn primitive (match existing file style: CVA variants, `cn()`, named exports), then compose feature widgets on top.
- Never invent a parallel button, input, dialog, or card look.
- Reuse `@theme` tokens; same radius, spacing, focus rings, primary/destructive/muted semantics everywhere.
- Icons: `lucide-react` with consistent stroke/size relative to control size.
- **Banned:** competing UI libraries; CSS modules that fork the look; inline styles that break token consistency.

Motor canvas bitmap chrome may use aligned hex as a documented exception; new Admin/Setup chrome must use semantic classes.

---

## 2. UX constitution — revealing UI and Microsoft-grade flows

Agents must obey these principles:

1. **Primary path first** — the default viewport shows only what completes the current job.
2. **Progress on interaction** — advanced options, metrics, and edge cases appear via expand, next step, drill-down, Sheet, or Tabs — never all-at-once.
3. **Self-explanatory UI** — labels, helpers, empty states, and inline validation replace manuals. Every control answers *what / why / what next*.
4. **Zero manual busywork** — sensible defaults, API prefills, one-click safe actions; confirm only for destructive or irreversible work.
5. **Microsoft-grade flows** — multi-step when complexity warrants it; clear next/back; visible progress; recovery paths; consistent chrome; keyboard parity; polish over novelty.
6. **One job per view** — if a screen needs “and also…”, split into a sub-route or staged `*Flow` / `*Step`.
7. **Enrich where value is high** — do not ship the thinnest possible CRUD. Prefer facilitators that reduce cognitive load (§3, §5).

**Revealing UI** means the UI starts calm and *earns* density as the operator engages — not the reverse.

---

## 3. Complex data and flow visualization (high emphasis)

**Policy:** complex payloads, timelines, state graphs, multi-step ops, and long config surfaces **must not** be unstructured text/JSON as the primary experience. Choose a visualization facilitator:

| Complexity | Preferred facilitation (shadcn-composed) |
|------------|------------------------------------------|
| Large tabular data | Sortable/filterable table; density; row → detail Sheet or detail route |
| Hierarchical / nested config | Nested disclosure or tree; summary row + expand |
| Time series / event logs | Timeline or segmented activity list with severity Badges |
| Multi-step procedures | Stepper / wizard (`*Flow`) with validation gates |
| Parallel status / health | Status strip + Badge variants; drill into degraded detail |
| Dense diagnostics | Overview cards → Tabs/sections → expandable probe results (not one mega-scroll) |
| Compare / before-after | Side-by-side panels or diff-style layout within tokens |

**Rules:**

- Reveal detail on selection (row click → Sheet / detail route), not by pasting everything into the page.
- Summarize first (counts, health, “needs attention”); expand on demand.
- When Admin surfaces Motor/Diagnostics truth, **legibility of complexity** is equal priority to API correctness.
- If a raw payload is unavoidable, put it last under collapsible **Technical details** — never as the primary view. See [frontend-patterns.md](frontend-patterns.md).

---

## 4. Information architecture — anti-god-page

| Limit | Rule |
|-------|------|
| Soft cap | ~**350 LOC** per page file — extract sections/flows |
| Investigate | **>500 LOC** — must split before merging new complexity |
| Debt example | `web/src/features/admin/DiagnosticsPage.tsx` (~760 LOC) — anti-pattern; decompose when touched |

- **Route = one primary job.** Complex jobs → nested routes or `*Flow.tsx` / `*Step.tsx`.
- Prefer **sub-pages** for depth: list → detail → advanced (see `SessionsPage` / `SessionDetailPage`).
- Sidebar labels stay short; rare tools under secondary nav or **Advanced**.
- Do not use Tabs to dump unrelated jobs onto one god page — Tabs are for peer facets of **one** job.

---

## 5. Component architecture — enrichment and anti-god-component

**Composition (top → bottom):**

```text
Page / Route
  → Flow or Section (*Flow, *Step, *Section)
    → Value-adding feature widget (table+detail, timeline, health strip, …)
      → components/ui/* shadcn primitive
```

- One component = **one user question** or one reusable interaction/visualization primitive.
- **Enrichment mandate** for non-trivial operator tasks — prefer:
  - Progressive disclosure / Accordion
  - Dialog / AlertDialog / Sheet (add as shadcn primitives on first need; Radix deps may already exist)
  - Tabs for peer facets of one job
  - Table + detail, Timeline, Stepper/wizard shells, Command/search when lists grow
  - Shared save/feedback strip; empty / error / loading scaffolds
- Place facilitators under `components/` or `features/*/components/` on first need. This constitution defines the **contract** before every file exists.
- **Forbidden:** bare `<pre>{JSON}</pre>` as primary UX; do-everything containers; widgets that ignore the shadcn look.

---

## 6. Visual and token system

- Semantic colors/radius from `@theme` in [`web/src/index.css`](../web/src/index.css) only.
- Typography and spacing: clear hierarchy (page title → section → control help).
- Motion: **2–3 intentional motions** per rich flow (feedback, step transition, expand) — never decorative noise.
- Cards: containers for **interaction** (forms, step panels). Not decorative dashboard wallpaper.

---

## 7. Interaction and state contracts

Every interactive surface must define UI for:

| State | Expectation |
|-------|-------------|
| Idle | Clear primary action |
| Loading | Disabled controls + visible progress |
| Empty | Teaching next action (not a blank void) |
| Success | Explicit confirmation (strip or inline) |
| Error | Visible, actionable, not toast-only |
| Degraded | Operator-visible (align with Diagnostics language when applicable) |

- Forms: controlled inputs; inline validation; Save disabled while pending; standardized success/error strip.
- Destructive: AlertDialog with consequence copy.
- No silent `catch` — errors must be user-visible.

---

## 8. Accessibility and keyboard

- Focus order matches visual order; visible focus rings via tokens/primitives.
- Every control has an accessible name (Label association or `aria-label`).
- Do not rely on color alone for status — pair with text or Badge labels.
- Modal work uses shadcn Dialog/Sheet — not naked absolute overlays (Motor connect overlay is a documented immersion exception until replaced with a primitive-backed pattern).

---

## 9. Copy and content

- Product UI language: **English** (current codebase).
- Verb-led buttons (`Save forwarding`, `Recover diagnostics`).
- Plain-language helpers; jargon expands on demand (tooltip / disclosure), never unexplained.
- **W7S** must not appear in operator-facing labels (wire vocabulary only — [naming.md](naming.md)).
- Empty states teach the next action in one short sentence + one CTA when possible.

---

## 10. Code structure and React practice

- Feature folders per [naming.md](naming.md). Motor engine modules (`MotorEngine`, connection, screencast, …) stay non-UI; page chrome stays thin.
- Prefer local React state + `lib/api.ts` / hub hooks until **cross-route** shared operator state is required — then introduce a minimal shared module, not a new global library by default.
- Match local conventions; no drive-by redesign of Motor realtime modules when touching Admin polish.
- Admin config section paths remain **PascalCase** via `ConfigSections` in `lib/api.ts`.

---

## 11. Frontend testing

- Fast gate: `web` lint + Vitest + build (see engineering-standards pyramid).
- New pure logic and non-trivial flow helpers get Vitest coverage.
- MotorAssert proves **motor truth**, not SPA visual polish — polish is enforced by this constitution and the merge checklist.
- Do not weaken product contracts to green UI tests.

---

## 12. Explicit anti-patterns

| Ban | Why |
|-----|-----|
| Second UI kit or non-shadcn look | Breaks visual consistency |
| God page (>500 LOC dumping many jobs) | Unreviewable; saturates operators |
| God component (fetch + layout + all fields + toasts) | Untestable; blocks reuse |
| JSON / text wall as primary UI | Hides structure; fails complex-viz policy |
| Thin CRUD when a viz facilitator was required | Microsoft-grade bar missed |
| Settings dump (every field visible at once) | Violates revealing UI |
| Mystery-meat icon buttons without labels/tooltips | Ambiguous actions |
| Toast-only errors | Easy to miss; not actionable |
| Tabs as a dumping ground for unrelated jobs | Fake IA; still a god page |
| W7S in operator-facing copy | Vocabulary leak |
| Raw hex in Admin/Setup chrome | Token drift |
| Silent catch / empty error UI | Breaks trust |
| Softening MotorAssert / skipping properties for UI green | Engineering policy violation |

---

## 13. Merge checklist (frontend)

- [ ] Built only with shadcn `components/ui` + `@theme` tokens.
- [ ] Revealing UI: primary path first; no saturation.
- [ ] Complex data/flows use a visualization facilitator (not a raw dump).
- [ ] Multi-step or drill-down used where complexity warrants.
- [ ] Page/component LOC and split OK (no new god files).
- [ ] Loading / empty / success / error (and degraded where relevant) are explicit.
- [ ] a11y basics: labels, focus, non-color-only status.
- [ ] New reusable recipe documented in [frontend-patterns.md](frontend-patterns.md) if canonicalized.
- [ ] [../web/README.md](../web/README.md) updated if routes or structure changed.
- [ ] Fast gate: `npm test` / lint / build in `web/`.

---

## 14. Where detail lives

| Concern | Canonical doc |
|---------|----------------|
| This constitution | This file |
| UX recipes / decision trees | [frontend-patterns.md](frontend-patterns.md) |
| Diagnostics Timeline UX | [diagnostics-timeline-ux.md](diagnostics-timeline-ux.md) |
| Diagnostics Analysis UX | [diagnostics-analysis-ux.md](diagnostics-analysis-ux.md) |
| Web routes / structure | [../web/README.md](../web/README.md) |
| Naming / motor folders | [naming.md](naming.md) |
| System design | [architecture.md](architecture.md) |
| Repo engineering / tests / CI | [engineering-standards.md](engineering-standards.md) |
| Agent entry | [../AGENTS.md](../AGENTS.md) |
| Cursor rule (`web/**`) | [../.cursor/rules/speculum-frontend-standards.mdc](../.cursor/rules/speculum-frontend-standards.mdc) |

This file and [frontend-patterns.md](frontend-patterns.md) are the permanent frontend UX law.

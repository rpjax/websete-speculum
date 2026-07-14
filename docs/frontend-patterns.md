# Speculum Frontend Patterns (mandatory recipes)

**Audience:** humans and AI agents implementing UI under `web/`.  
**Status:** approved recipes — **copy these; do not invent competing patterns.**  
**Law:** [frontend-standards.md](frontend-standards.md). This file is the how-to companion.

When a new reusable recipe becomes canonical, add it here in the **same PR**.

---

## 1. shadcn and visual consistency

### 1.1 Extending `components/ui` (checklist)

When a needed primitive is missing (Dialog, Sheet, Tabs, Table, Accordion, AlertDialog, …):

1. Add `web/src/components/ui/<name>.tsx` matching existing style (`button.tsx`, `card.tsx`, …).
2. Use Radix primitive + CVA variants + `cn()` from `@/lib/utils`.
3. Semantic classes only (`bg-card`, `text-muted-foreground`, `border-border`, …) — no one-off hex.
4. Named export(s); keep the file focused on presentation, not feature data fetching.
5. Prefer `lucide-react` icons that fit control size (`h-4 w-4` adjacent to `sm` controls).
6. Do **not** install a competing component library.

### 1.2 Tokens, `cn`, CVA

```tsx
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

<Button variant="outline" size="sm" className={cn(extra && 'opacity-80')}>
  Save forwarding
</Button>
```

- Variants belong in CVA on the primitive, not scattered Tailwind forks on every call site.
- Theme tokens live in `web/src/index.css` `@theme`. Extend tokens there when the product needs a new semantic — do not invent local color systems.

### 1.3 Iconography

- One icon set: `lucide-react`.
- Icon-only controls **must** have an accessible name (`aria-label` or Tooltip with visible fallback eventually).
- Prefer icon + text for primary Admin actions.

### 1.4 Motor canvas exception

Motor screencast chrome may use hex aligned with theme for canvas overlays. New Admin/Setup chrome must use tokens. Prefer migrating Motor chrome to tokens when touching that surface.

---

## 2. Revealing UI and flows

### 2.1 Revealing settings (summary + Advanced)

**Use when:** a config page has a common path and rare options.

```text
[Section title + one-line helper]
[Primary fields only]
[Save strip]

▸ Advanced                    ← collapsed by default
    [edge-case fields]
```

- Default viewport solves the main job without Advanced.
- Advanced never hides a **required** field for the primary path.

### 2.2 Guided setup / operator wizard (`*Flow`)

**Use when:** first-run, multi-decision ops, or irreversible sequences.

| Piece | Responsibility |
|-------|----------------|
| `*Flow.tsx` | Step index, validation gates, next/back, submit |
| `*Step.tsx` | One job; exports validity to the flow |
| Layout | Progress (step N of M), verb-led Continue / Back |

- One question (or tight cluster) per step.
- Block Continue until the step is valid; show inline errors on the step, not only at the end.
- Setup (`/setup`) should grow toward this shape when expanded beyond status.

### 2.3 Admin config section (Card + Label + helper + Save)

**Canonical local pattern** (existing MaxSessions / Forwarding style, enriched):

```text
Card
  CardHeader: title + short description (why this matters)
  CardContent:
    Label + control
    Helper text (muted): consequence / units / default
    … more primary fields
  Footer / strip:
    [Save] disabled while pending
    success (muted green / semantic) | error (destructive)
```

- Controlled inputs; PascalCase section keys via `ConfigSections`.
- Do not leave Save without pending/disabled and without error surfacing.

### 2.4 List → detail drill-down

**Canonical:** `SessionsPage` → `SessionDetailPage` (`/admin/sessions`, `/admin/sessions/:sessionId`).

```text
List route: summary columns + filter + empty state
  → row navigate / open
Detail route: focused facets (overview + Tabs for peer aspects)
  → optional Advanced / Technical details
```

Prefer a **route** for deep operator work; use Sheet for quick peek when leaving the list context would hurt.

### 2.5 Motor connect / recover overlay

Immersive Motor: keep canvas primary. Connection and recovery states reveal progressive status (connecting → ready / retry) without Admin-density chrome.

- Message + one clear action (Retry / Reload).
- Avoid dumping hub/wire jargon; keep operator language.

### 2.6 Destructive confirm (AlertDialog)

```text
Title: irreversible action named plainly
Body: consequence in one–two sentences
Actions: Cancel (default focus) | Confirm (destructive variant)
```

Never use a silent icon click for destroy/rotate/wipe without confirm.

### 2.7 Empty / first-run coaching

Empty states:

1. One sentence of context.
2. One primary CTA (create, connect, open docs path, or navigate).
3. Optional secondary “Learn more” disclosure — not a wall of text.

### 2.8 Route steps vs Tabs vs disclosure — decision tree

```text
Is it a multi-decision sequence with gates?
  YES → *Flow / wizard (or nested routes per step)
  NO  → Is it peer facets of ONE job on one URL?
          YES → Tabs (or segmented control)
          NO  → Is detail optional / rare?
                  YES → Disclosure / Accordion / “Advanced”
                  NO  → Separate sub-route (list → detail)
```

**Never** use Tabs to glue unrelated jobs into one page.

### 2.9 Size and split decision tree

```text
Page file trending >350 LOC or adding a second job?
  → Extract *Section for each job facet
  → Or *Flow / *Step for sequences
  → Or nested route for depth

Single component fetching + rendering + every field + toasts?
  → Split: data hook / loaders | presentational section | shared Save strip
```

Debt reference: `DiagnosticsPage.tsx` — when touched, decompose toward overview → Tabs → expandable results (§3.1).

---

## 3. Complex visualization recipes

### 3.1 Dense diagnostics (overview → tabs → expand)

```text
Header: health summary (Badges: Healthy | Degraded | …) + primary Recover action
Overview cards: counts / budgets / “needs attention”
Tabs: peer facets (e.g. Events | Probes | Governance)
  Within tab: filterable list or timeline
  Row / item → expand or Sheet with structured fields
Technical details (last, collapsed): raw payload only if required
```

Do not ship one endless scroll of every probe and blob.

### 3.2 Event / activity timeline

```text
[severity Badge]  time  short title
                 helper / entity id
                 ▸ details
```

- Newest first unless the operator explicitly chooses chronological.
- Severity via Badge + text, not color alone.

### 3.3 Filterable table + row detail

```text
Toolbar: search / filters / density
Table: essential columns only
Row click → Sheet (peek) or detail route (deep work)
Empty: coaching CTA
```

Add primitives (`table`, `input` filter, `sheet`) under `components/ui` on first need.

### 3.4 Nested config explorer

```text
Summary row: name + status Badge + one-line value
▸ expand: nested fields (or child routes for large trees)
```

Primary path edits live fields in place; bulk/raw JSON stays under Technical details.

### 3.5 Multi-status health strip → degraded drill-in

```text
[● Domain A OK] [● Domain B Degraded] [● Domain C OK]   [View degraded]
```

Clicking degraded opens a Sheet or filtered tab with actionable recovery — not a dump of the entire diagnostics catalog.

### 3.6 Raw payload (last resort)

When Act→Assert or ops truly need raw bytes/JSON:

1. Structured view first.
2. Collapsible **Technical details** last.
3. Monospace, copy button optional; never full-page `<pre>` as the landing experience.

---

## 4. Enrichment catalog (prefer these over thin CRUD)

| Situation | Prefer |
|-----------|--------|
| Multi-step operator task | `*Flow` + progress |
| Long form with rare options | Revealing settings + Advanced |
| Many entities | Table + filter + detail |
| Time-ordered events | Timeline + severity |
| Health across domains | Status strip + drill-in |
| Destructive / rotate | AlertDialog |
| Peer facets one job | Tabs |
| Quick peek without leave-list | Sheet |
| First visit / empty | Coaching empty state |
| Lists become hard to scan | Command / search (add on need) |

If the thinnest CRUD would hide structure, **enrich** — that is mandatory under [frontend-standards.md](frontend-standards.md) §2–§3.

---

## 5. Interaction strip (Save / feedback)

Standardize Admin mutations:

| Element | Behavior |
|---------|----------|
| Primary button | Verb + noun; disabled while `pending` |
| Success | Inline strip; clear message disappears on next edit or after short acknowledge |
| Error | Inline destructive text; keep field values; offer retry |

Prefer inline strips over toast-only for config pages.

---

## 6. Accessibility notes for recipes

- Dialog/Sheet: focus trap + Esc to dismiss; restore focus to trigger.
- Tables: header cells; sortable columns announce state when sorting ships.
- Steps: `aria-current` on the active step.

---

## 7. Where this sits

| Doc | Role |
|-----|------|
| [frontend-standards.md](frontend-standards.md) | Constitution (must / never) |
| **This file** | Recipes and decision trees |
| [../web/README.md](../web/README.md) | Routes and package map |
| [engineering-standards.md](engineering-standards.md) | Repo-wide engineering / tests / CI |

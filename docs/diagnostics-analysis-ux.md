# Diagnostics Analysis UX contract

**Status:** acceptance criteria for Analysis (`/admin/diagnostics/analysis`).  
**Law:** [frontend-standards.md](frontend-standards.md) (revealing UI, Microsoft-grade).  
**Product job:** turn a chosen period’s diagnostics evidence into a **complete didactic report** — routine and friction alike — independent of the Timeline viewport.

## Separation from Timeline

- Analysis owns its **mandate** (period, scope, depth, profile, evidence toggles).
- **No live sync** with Timeline selection/playhead/layers.
- Deep links are one-shot query prefills (`from`, `to`, `connectionId`) only.
- Timeline may offer a discrete “Analyze this period…” link; Analysis may offer “View period on Timeline” — neither owns the other’s chrome.

## Mandate (first step)

**Primary (always visible):** period (from/to), scope, study profile, **Run analysis**.  
**Advanced (collapsed):** depth, evidence toggles (events, telemetry, runtime, snapshots).

Calm first step — not a wall of checkboxes.

## Report acceptance (must pass)

1. **Typography hierarchy** — Cover → section lead paragraphs → typed callouts → glossary → collapsible technical appendix.
2. **Completeness** — `info` and `notable` findings are first-class. Success/routine sections stay even when there are no errors.
3. **Attention** — Problems live in **one** Attention section; they do not become the whole report.
4. **Didactic tone** — Each callout: what happened, what it means, what to do next (when severity is attention/critical).
5. **Export** — Human-readable Markdown (structured headings), plus structured JSON for archival — not a raw findings dump as the primary export story.
6. **Navigation** — Sticky TOC with jump-to-section; optional keyboard-friendly focus order.

## Pipeline (already owned by code)

Collect → analyzers (dynamic) → narrate → render. Enrich **presentation and prose templates**; keep analyzers deterministic and Vitest-covered.

## Out of scope

Server-side “generate report” endpoint; LLM narration; shared React state with Timeline.

## PR merge checklist (this surface)

Run [frontend-standards.md](frontend-standards.md) §13, plus:

- [ ] Mandate primary path is calm; depth/evidence under Advanced.
- [ ] Report has cover, section leads, typed callouts; Attention is one section.
- [ ] `info` / `notable` remain first-class; empty sections still present with coaching.
- [ ] Markdown export is human-readable; Timeline link is discrete (TOC footer).
- [ ] Structure Vitest: required sections present with zero findings.
- [ ] Recipe in [frontend-patterns.md](frontend-patterns.md) §3.2 matches this contract.

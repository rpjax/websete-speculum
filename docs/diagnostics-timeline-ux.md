# Diagnostics Timeline UX contract

**Status:** acceptance criteria for the Narrative Timeline (`/admin/diagnostics/timeline`).  
**Law:** [frontend-standards.md](frontend-standards.md) (revealing UI, Microsoft-grade, complex-viz).  
**Product job:** read the Motor’s story — chronological, multi-lane, semantic — not plot charts.

## Vocabulary (operator-facing)

| Term | Meaning |
|------|---------|
| Narrative | The reconstructed story for the current scope + period |
| Lane | Parallel track (one session, or System) |
| Chapter | Correlated story unit (usually one `correlationId`) |
| Span | Timed action (Open→Close) inside a chapter |
| Beat | Single event fact |
| Reading controls | Scope, period, detail, optional filters/layers |

## Layout (first viewport)

```text
[ compact strip: Scope | Period | Detail | Reading options ▸ | Refresh ]
[ canvas ≥60% of remaining viewport — sticky time rail ]
  Lane | labeled chapters on shared time axis …
  Beat ribbon (only when Detail = Full beats)
[ Sheet on selection — peek, not the primary read ]
```

## Acceptance (must pass)

1. **Primary path** — Opening Timeline, ≥60% of the first viewport is the narrative canvas. Reading controls fit in **one compact strip**; Domain / Severity / Search / Layers live under **Reading options** (collapsed by default).
2. **Readable without Sheet** — Each chapter on the canvas shows a **semantic label** (e.g. Navigation, Session lifecycle), an **outcome badge** (text + color), and **duration**. Hover shows one line of prose (`proseHint`).
3. **Empty-in-view lanes** — A lane with no activity in the current time window is not a blank row: show coaching (“1 chapter earlier” / “outside view”) and **Jump** or rely on **Fit**.
4. **Temporal navigation** — Zoom ±, pan (drag or keyboard), Fit-to-data. “Load earlier” is secondary, not the hero control.
5. **Clustering** — Beats at the same instant → `•(N)` marker → Sheet with a didactic list (replaces Feed).
6. **Granularity** — Chapters → Chapters+spans → Full beats changes density only; the UI remains a **narrative**, never a chart mode switcher.
7. **Analysis separation** — No prominent Analysis CTA in Timeline chrome. Optional discrete link under Reading options / overflow: “Analyze this period…” (query prefill only; no shared live state).
8. **States** — Canvas skeleton while loading; empty coaching; actionable error; Live = small badge when on.

## Interaction

- Hover chapter → cross-highlight related spans / causation; tooltip with prose.
- Click chapter / cluster / lane → Sheet (prose first; Technical details last).
- Keyboard: arrows pan, `+`/`-` zoom, Enter opens focused chapter (when focus is on canvas).
- Temporal pan/zoom changes only the **visible time domain** — never CSS-transforms the lane DOM. Wheel/drag on the TimeRail; Zoom±/Fit in the strip. Temporal content is **clipped** to the track (`overflow-hidden`); the canvas scrolls vertically only when there are many lanes.

## Out of scope for this surface

Histogram / heatmap / cumulative chart modes; Activity list/Feed; SignalR streaming; generating Analysis reports inside Timeline.

## PR merge checklist (this surface)

Run [frontend-standards.md](frontend-standards.md) §13, plus:

- [ ] First viewport ≥60% canvas; Reading options collapsed by default.
- [ ] Chapters show label + outcome + duration; hover prose works.
- [ ] Empty-in-view lanes coach + Jump; Zoom± / Fit work; Load earlier is secondary.
- [ ] No prominent Analysis CTA; overflow “Analyze this period…” only.
- [ ] Canvas keyboard: arrows / `+` `-` / Enter; layer toggles labeled.
- [ ] Recipe in [frontend-patterns.md](frontend-patterns.md) §3.2 matches this contract.

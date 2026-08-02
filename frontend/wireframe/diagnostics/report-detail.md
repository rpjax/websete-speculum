# Diagnostics report detail

## Job
Read a materialized ResourceReport as narrative chapters with optional embedded series summaries and links to evidence — not a JSON dump.

## Route / params / auth gate
- Route: `/admin/diagnostics/reports/:reportId`
- Params: `reportId` (uuid)
- Auth: Bearer access

## Entrada (pré-condições, deep-link)
Reports list; post-create redirect from report-flow; optional deep-link from notifications later.

## Layout (ASCII regiões)

```
PageHeader: {kind label} · StatusPill · [Back to reports]

[ Window: from → to · createdAt · readyAt ]
[ Summary paragraph ]

Pending: HelperCallout “Materializing…” + poll
Failed: errorCode + phase + Retry generate NBA

Ready:
  Chapter 1 title
  Body (prose)
  Optional seriesSummary spark / key stats (reveal for sample ids)
  Links: related signals → Signals; Jump resources for window

  Chapter 2 …
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| back | link | Back to reports | | | no | |
| status | status-pill | Status | pending/ready/failed | API | yes | |
| summary | text | Summary | | API | yes when ready | |
| chapter | report chapter block | Title + body | | API | yes when ready | |
| series.reveal | reveal-panel | Series snapshot | Embedded seriesSummary | closed | no | |
| evidence.signals | links | Related signals | relatedSignalIds | | no | |
| jump.resources | link | Open window in Resources | from/to | | no | query |
| nba.retry | next-best-action | Generate again | On failed | | no | flow with same kind/window |

## Copy (strings)
- Back: `Back to reports`
- Pending: `Materializing report from Journal samples…`
- Failed title: `Report failed`
- Failed body: `{errorCode} · phase {phase}`
- Retry: `Generate again`
- Jump: `Open this window in Resources`
- Related signals: `Related signals`
- Series reveal: `Series snapshot`
- Not found: `Report not found`

## Inteligência UX nesta view
Primary path: read summary → chapters top-down. Series snapshots are supporting evidence in reveals. Jump to Resources for interactive chart of the same window.

## Path feliz (passos numerados)
1. Open ready report. 2. Read summary and chapters. 3. Optionally open related signal or Resources window.

## Reveals
Per-chapter seriesSummary and raw sample id lists.

## Estados (loading/empty/error/success/blocked)

| state | UI |
|-------|-----|
| loading | Skeleton |
| pending | Poll GET until ready/failed (interval ~2–5s) |
| ready | Chapters |
| failed | errorCode + phase + NBA regenerate |
| 404 | EmptyState not found |

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| load | GET | `/api/admin/diagnostics/v1/reports/{id}` | — | ResourceReport |
| jump | navigate | `/admin/diagnostics/resources?from=&to=` | report window | — |

Chapters may include `seriesSummary` (precomputed min/avg/max per key) — front does not re-query full history unless operator jumps to Resources.

## Components usados
`PageHeader`, `HelperCallout`, `EmptyState`, `NextBestAction`, `RevealPanel`, `StatusPill`.

## Navegação (vem de / sai para)
From reports list / flow; to Signals, Resources, reports list, report-flow retry.

## Teclado / a11y notas
Chapters as headings hierarchy `h2`/`h3`; pending state announced politely (aria-live polite).

## Aceite de build
- [ ] Ready report never shows raw JSON as primary UI
- [ ] Failed always surfaces `errorCode` + `phase`
- [ ] Pending polls until terminal status
- [ ] Jump preserves from/to on Resources

## Explicitamente fora
Re-running detector from detail; editing chapter text; Host resources apply.

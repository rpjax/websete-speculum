# Diagnostics timeline

## Job
Read the Motor/Journal **story** — chronological, multi-lane, semantic — not dump a raw event list.

## Route / params / auth gate
- Route: `/w7s/admin/diagnostics/timeline`
- Params: `?sessionId=` · `?connectionId=` (alias) · `?from=` · `?to=`
- Auth: Bearer access

## Entrada (pré-condições, deep-link)
Diagnostics nav · command palette · session deep-link · Investigate overflow.

## Layout (ASCII regiões)

```
[ title + one-line job ]
[ compact strip: Scope | Period | Detail | Zoom± Fit | Options ▸ | Refresh | ⋯ ]
[ canvas ≥60% viewport — sticky TimeRail ]
  Lane | labeled chapters on shared time axis …
  Beat ribbon (Detail = Full beats) · empty-lane Jump
[ Sheet on selection — prose first, Technical details / payload last ]
```

## Inventory de controlos

| id | tipo | label | helper |
|----|------|-------|--------|
| scope | select | Scope | Platform or live session |
| period | select | Period | 15m / 1h / 6h / 24h / custom |
| granularity | select | Detail | Chapters → +spans → Full beats |
| zoom | buttons | Zoom± / Fit | View domain only (no CSS transform) |
| options | disclosure | Reading options | Domains, severity, search, layers |
| live | layer | Live | Journal tail by sequence |
| chapter | canvas | Chapter | Semantic label + outcome + duration |
| beat | canvas | •(N) | Cluster → Sheet list |
| sheet | sheet | Selection | Prose first; payload under Technical details |

## Copy (strings)
- Title: `Timeline`
- Description: `Narrative reader over durable Journal facts — lanes, chapters, and beats. Payload stays in the sheet.`
- Empty: `No narrative in this period`
- Overflow: `Investigate this period…`

## Inteligência UX nesta view
Primary job is **reading a story**. Canvas first; list/Feed is not the primary UX. Charts/signal overlays stay optional under Options. Payload is reveal-only in the Sheet.

## Path feliz
1. Open Timeline → canvas fills most of the viewport.  
2. Pan/zoom TimeRail; Fit when lost.  
3. Click a chapter / cluster → Sheet with prose.  
4. Expand Technical details only when raw Journal payload is needed.

## Dados / API

| ação UI | método | path |
|---------|--------|------|
| load / earlier / live | GET | `/api/admin/diagnostics/v1/timeline?since&until&sessionId&afterSequence&beforeSequence&limit` |
| scope sessions | GET | `/api/sessions` |

Response: `{ items[], latestSequence, nextBeforeSequence, truncated }` — mapped client-side into narrative lanes/chapters/beats.

## Aceite de build
- First viewport ≥60% narrative canvas; Options collapsed by default.
- Chapters show label + outcome + duration; hover prose works.
- Empty-in-view lanes coach + Jump; Zoom± / Fit work.
- No raw full-page event list as the landing experience.
- Payload only under Sheet Technical details.

## Explicitamente fora
- Legacy Diagnostics ring `/events` as the Timeline primary source.
- Charts / heatmap / histogram as the primary timeline.
- Sessions/Stories/Feed list views as the Timeline primary UX.
- Prominent Analysis CTA in chrome (overflow Investigate only).

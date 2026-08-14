# Implementation — `interaction.ts` (web)

**Future path:** `Refactor/web/src/features/sessions/live/page/interaction.ts`  
**LOC ceiling:** 400  
**Contracts:** [10-interaction.md](../../contracts/10-interaction.md), [05-establish.md](../../contracts/05-establish.md), [08-surface.md](../../contracts/08-surface.md)  
**Norm:** redesign §5.9.2–5.9.4, §5.11; sealed input as amended  

---

## Purpose

Local-first interaction on the Projected surface: native hover/active/focus-visible; immediate scroll and typed echo; **client-authoritative caret**; intents addressed by `uint32` nodeId; **no pointer intents before arm**; scroll intent coalesce (last sample per scroller). Provides the caret reconcile hook to `applyDom`.

---

## Invariants

1. Perception is local; truth is authoritative (§5.9.2).
2. `:hover`, `:active`, `:focus-visible`, CSS transitions — native only; never round-tripped.
3. Pointer intents require `armed === true`; otherwise queue or visibly refuse — **never** silent mis-target (PP-EST-5).
4. Intents carry `nodeId: u32` (+ coords as needed); never `speculum-anchor` strings for Virtual resolve (PP-IN-5).
5. Coordinates: iframe content-box CSS px → mapped to Virtual viewport by existing input §6.3 as amended §5.8.7.
6. Scroll: local paint immediate (P4); intents coalesced per scroller, last sample (PP-IN-3); never drop under pressure — collapse to latest.
7. Caret/selection never dictated by Virtual (PP-IN-2).
8. While desynced: disarm; same as unarmed for pointer intents.
9. No wire `click` opcode — intents are input-plane messages (sealed input).

---

## Bans

- Sending intents before arm / while desynced.
- Resolving targets by CSS query for intent addressing when registry id is available from hit-test.
- Blocking local paint on network (P4).
- Applying upstream caret indices.
- Synthetic full-page click without nodeId when a node was hit.

---

## Types and signatures

```ts
export type Intent =
  | { type: 'pointer'; name: 'down' | 'up' | 'move' | 'cancel'; nodeId: number; x: number; y: number; buttons: number; mods: number }
  | { type: 'key'; name: 'down' | 'up'; nodeId: number | 0; key: string; code: string; mods: number }
  | { type: 'scrollViewport'; scrollX: number; scrollY: number }
  | { type: 'scrollElement'; nodeId: number; scrollTop: number; scrollLeft: number }
  | { type: 'input'; nodeId: number; value: string }
  | { type: 'files'; nodeId: number };

export type InteractionOptions = {
  armed: boolean;
  desynced: boolean;
  registry: Registry;
  getSurfaceDocument: () => Document;
  getContentBox: () => DOMRectReadOnly;
  sendIntent: (intent: Intent) => void;
  onRefuseInput?: (reason: 'unarmed' | 'desynced') => void;
};

export type InteractionController = {
  attach(doc: Document): void;
  detach(): void;
  setArmed(armed: boolean): void;
  setDesynced(desynced: boolean): void;
  flushScrollIntents(): void;
  caretHook: CaretReconcileHook;
  markControlDirty(el: Element): void;
  clearControlDirty(el: Element): void;
};

export function createInteraction(opts: InteractionOptions): InteractionController;
```

Exact intent field set MUST match sealed `input.md` as amended — this module ports DomElementInput → id addressing only (module map).

---

## Algorithm — hit → nodeId

```
on pointer event inside iframe document:
  target = event.target as Node
  walk up to find registered element:
    preferred: element.closest('[speculum-anchor]') → parse id
    OR registry side lookup if maintained
  if no id:
    // background / non-published: MAY send viewport-only intent per sealed input
    // MUST NOT invent a wrong id
  coords = event client coords relative to iframe content box
  if !armed || desynced:
    refuse or queue (see below)
    return
  sendIntent({ type:'pointer', nodeId, x, y, … })
```

---

## Algorithm — arm / queue / refuse (PP-EST-5)

```
policy (both allowed by contract):
  A. Queue pointer down/up until arm, then flush in order (cap queue; drop oldest with visible refuse if overflow)
  B. Visibly refuse: no send; UI shows loading / ignore clicks

MUST NOT: deliver click to a partial tree that hit-tests wrong (BZ10 class).
```

Desync: force disarm; clear queue or refuse (D12).

---

## Algorithm — local-first classes

| Class | Local behaviour | Upstream |
|-------|-----------------|----------|
| Hover/active/focus-visible | Native CSS | none |
| Scroll | Browser paints; sample intent | scroll intent coalesced |
| Typing | Native; mark dirty | patches reconcile via caret hook |
| Focus | Native | patch may reconcile on conflict |
| Navigation / submit | Instant local progress affordance | Virtual authoritative |

---

## Algorithm — scroll coalesce (PP-IN-3)

```
scrollDirtyLocal: Map<nodeId|VIEWPORT0, position>

on scroll event:
  paint already happened
  record last sample for that scroller key
  schedule flushScrollIntents on rAF

flushScrollIntents:
  for each entry: sendIntent(scrollViewport | scrollElement)
  clear map

Under pressure: only last sample — never enqueue N scrolls per frame.
```

Echo suppression is Virtual-side; client always may send.

---

## Algorithm — caret hook (PP-IN-2)

```
dirty: WeakSet<Element>

on 'input'/'beforeinput' on text controls: dirty.add(el)

applyInputValue(el, next):
  if !dirty.has(el):
    el.value = next; return
  save selectionStart/End
  prev = el.value
  if next === prev: restore selection; return
  el.value = next
  try setSelectionRange(clamped)
  on failure: prefer user caret; report conflict

When echo caught up: dirty.delete(el)
```

---

## Algorithm — files / keys

Follow sealed input: `setFiles` via intent with nodeId; key events with nodeId of focused registered control or 0 per seal.

---

## Tests

| ID | Assert |
|----|--------|
| `PP-IN-1` | Hover/active/focus-visible within P4 with network stalled |
| `PP-IN-2` | Upstream value patch does not move caret while dirty |
| `PP-IN-3` | Scroll paints within P4; intents last-sample |
| `PP-IN-4` | Click → authoritative effect ≤ P5 |
| `PP-IN-5` | Intents carry u32; Virtual miss = retry-then-drop |
| `PP-EST-5` | Pre-arm clicks queued or visibly refused |
| Disarm | Desync stops pointer sends |

# PageProjection Input V2

**Status:** normative for V4 / cutover gate 6 ([roadmap.md](roadmap.md)).  
**Supersedes** unrevised sections of [input.md](input.md) wherever they conflict — especially dispatch primary for press/up and §6.3 surface vs document scroll height.  
**Boundary:** input is a **separate feature** — it must not change the frame algorithm (`virtual/**`, opcodes, apply/resync).

**Ruling 2026-08-22:** element activation is **id-assertive**. Coords-only CDP for `mousedown`/`mouseup` is a **defect**, not the design. Lab M1 blueprints (2026-08-20) remain the effect bar; Browse / Live / `resolveAndClick` share `DomElementInput.dispatchMouse` (resolve → hit point in box → CDP).

**Ruling 2026-08-22 (input = no sync):** the input plane **does not sync** with frame generation, apply, or resync. It is a dumb pipe: capture → intent → resolve `nodeId` when required → CDP. Dropping intents as `generation_stale`, CDP-reading generation, or coupling frame headers into dispatch is a **defect**.

---

## Three planes

```text
Projected  ──intents──►  sidecar (serial CDP chain)  ──►  Virtual
Virtual    ──frames──►  sidecar  ──DataPlane──►  Projected
Projected  ──control──►  sidecar  (requestResync, snapshot, …)
```

Production: web/hub → sidecar → CDP. Lab: `client.intent` on lab WS.

Frames sync DOM/CSSOM. Input only injects gesture — **no shared generation gate** between the two planes.

---

## Intent envelope V2

| Field | Type | Notes |
|-------|------|-------|
| `schemaVersion` | u8 | `1` |
| `contextId` | u32 | Same as frame header; root = `1` |
| `generation` | u32 | Optional journal/debug only — **not** a dispatch gate |
| `type` | string | See dispatch table — **no wire `click`** |
| `nodeId` | u32 \| null | Required for element intents; null only where the table allows |
| `timestampClient` | f64 | Optional |
| `payload` | JSON | Coords, keys, scroll, form values |

Hub DTO: [PageProjectionIntent.cs](../../Refactor/Speculum.Api/Sessions/Mirror/PageProjection/PageProjectionIntent.cs) (`targetId` = `nodeId`, `contextId` default `1`).

---

## Dispatch primary (LOCKED 2026-08-22)

### Principle

Projected capture is **listeners on the projected document**. Sidecar dispatch is **assertive by node id** for anything that means “act on this element.” Pixel coords alone must not be the activation algorithm — they drift when Projected scroll / DOM lag Virtual (real sites: Eneba-class).

`ok: true` / `status: dispatched` after CDP at an arbitrary `(x,y)` is **not** success if the intent carried a `nodeId` that was never resolved.

### Per-type primary

| Type | `nodeId` | Primary on Virtual | Coords role |
|------|----------|--------------------|-------------|
| `mousedown` / `mouseup` / `pointerdown` / `pointerup` | **Required** | Resolve `(contextId, nodeId)` → Element. CDP press/release on that element (center of box, or payload offset **inside** the element’s client box — never page coords in isolation) | Optional hit offset relative to the resolved element |
| `focus` / `blur` | **Required** | Resolve id → focus/blur that element | None |
| `input` | **Required** | Resolve id → set value / checked on that control | None |
| `keydown` / `keyup` | Preferred | If id present → focus then key; else page-targeted key (document shortcuts) | None |
| `scrollElement` | **Required** | Absolute `scrollTop`/`scrollLeft` on that element | None |
| `scrollViewport` | **null** | Absolute page `scrollX`/`scrollY` | None |
| `mousemove` / `pointermove` | null (or diagnostic only) | Surface → viewport CSS coords → CDP `mouseMoved` | **Primary** (continuous hover) |
| `wheel` | optional | Coords (and nested frame map) → CDP wheel; do not treat as activation | Primary for hit position |
| `setFiles` | **Required** | Resolve id → `setInputFiles` | None |

**No wire `click`.** Projected `click` / `contextmenu`: `preventDefault` as today; activation is only down+up (and motion path for antibot). Prefer trusted CDP press/release over in-page `el.click()`; `el.click()` only as logged fallback after press/release failure for that gesture — never both for the same gesture.

### Drop closed (fail closed)

Drop with an explicit reason (never silent “dispatched” at the wrong place):

| Condition | Example reason |
|-----------|----------------|
| Element intent missing `nodeId` | `node_id_required` |
| Resolve miss in Virtual map | `anchor_missing` / `node_unresolved` |
| Nested context frame missing | `context_frame_missing` |
| Wire `click` / `auxclick` | `ignored_wire_click` |
| Invalid motion coords | `invalid_coords` |
| CDP inject failure | `cdp_error` |

**Not a drop reason:** stale / mismatched `generation`. Sidecar must not compare intent generation to Virtual or frame headers.

Journal / lab Activity must surface drops. “Dispatched” without resolve for a required-id intent is a product bug.

### Nested documents

Same rules with `contextId ≠ 1`: resolve in the producer frame for that context. Nested capture already sends frame-local coords for **motion**; for **press/up**, id resolve is primary — nested bounding-box maps are for motion/wheel, not a substitute for missing id.

---

## Coordinate space (motion + optional offset)

Applies to **`mousemove` / wheel** and to **optional offsets** on press/up — not as the activation primary.

1. **`surface`** = the projection **stage** (lockstep CSS box / host that maps 1:1 to the Virtual viewport) — **not** `documentElement`’s full scroll height.
2. Map event viewport-local coords through that surface rect (or equivalent visible viewport: `innerWidth`/`innerHeight` when listeners sit inside the iframe and the stage already matches Virtual size) into Virtual viewport CSS px.
3. Clamp to the Virtual viewport.
4. Speculum chrome outside the surface does not emit intents.
5. Never scale against the projected document’s scrollable content height — that collapses Y on long pages (defect observed on Eneba).

Letterboxing / CSS scale: correct with `viewportSize / surfaceRectSize` when the stage is letterboxed inside a larger host.

---

## Client capture

Module: [`projectedInputCapture.ts`](../../Refactor/packages/page-projection/src/projected/input/projectedInputCapture.ts) (shared; `web/` SessionMirrorSurface + lab client attach it).

- Listeners on the **Projected `Document`** (capture phase), not on a cached `documentElement` — apply may replace `<html>` in place; Document identity is stable for one surface iframe.
- After a **resync iframe swap** (new Document), `ProjectionClient` **`onArmed` fires again** — composition roots MUST re-attach capture (lab + Live already do via `onArmed → bindInput`). Treating `onArmed` as once-only is a defect (leaked native `<a href>` → navigates the stage iframe off the projected document).
- **Armed** = local gate only (“surface exists / apply ready”); **zero intents** while disarmed. Not a Virtual generation sync. `click`/`submit`/`contextmenu` still `preventDefault` while attached (even if disarmed) so the stage cannot navigate away.
- For activate: resolve `nodeId` via registry (interactive prefer + nearest id walk) — same spirit as lab `resolveAndClick`.
- Move coalesce @ rAF; flush before down/up.
- Local-first scroll: do not `preventDefault` wheel — overflow paints; `scroll` → `scrollElement` / `scrollViewport`.
- Form edit: `markPropDirty(nodeId)` → `FormPropDirty` skip on upstream `PROP_SET`.
- Cross-realm: never `instanceof HTMLElement` from the shell Window against Projected nodes — use `nodeType` / `tagName`.
- Scroll echo (`consumeScrollEcho`) must be wired on lab + Live when Virtual applies programmatic scroll — prevent feedback loops; does not replace id-assertive press.
- Envelope `generation` may be filled for journal/debug; sidecar ignores it for dispatch.

---

## Sidecar dispatch

Modules: [`pageProjectionInputDispatch.ts`](../../Refactor/sidecar/browser/mirror/projection/input/pageProjectionInputDispatch.ts) + [`DomElementInput.ts`](../../Refactor/sidecar/browser/patchright/mirror/dom/DomElementInput.ts).

**Required order for element pointer intents:**

1. **Resolve `(contextId, nodeId)`** → Virtual `ElementHandle` via `__speculumProjection.domNodes.get` in the correct frame. Miss → drop.
2. Compute CDP page point from the **resolved element’s box** (payload point inside box, else center). Nested: map frame-local → page if needed.
3. Inject chain: flush coalesced move if any, then `mouseMoved` → `mousePressed` / `mouseReleased` at that point (or equivalent Patchright mouse on the handle).
4. Motion-only intents skip step 1–2 resolve and use surface→viewport coords only.

**Forbidden on the intent path:** CDP `evaluate` for generation, `noteGeneration` from frame headers, `generation_stale` drops.

Entry: `PageProjectionBrowserSession.pushInput` / gRPC `PushDomInput` / lab `client.intent`. Blueprint `resolveAndClick` and the live path share id-first press/up.

**Impl:** `DomElementInput.dispatchMouse` resolves `targetId`, then CDP at the payload point when it lies inside the resolved box, otherwise box center. Missing id → `node_id_required`; resolve miss → `anchor_missing`.

---

## Why not coords-only activation

| Failure mode | Coords-only | Id-assertive |
|--------------|-------------|--------------|
| Projected scrolled ahead of Virtual | Miss | Hits resolved node (or drops closed) |
| Overlay / sticky / transform | Pixel under cursor ≠ intended control | Intended control |
| DOM desync (Projected shows node Virtual lacks) | False “dispatched” | Drop `node_unresolved` |
| Long-page surface rect bug | Systematic Y collapse | Irrelevant to primary |

Scroll can still “look fine” on Projected while Virtual lags — that is a **scroll lockstep** concern, not a license for coords-only click.

---

## MVP gates (lab blueprints)

Closed 2026-08-20 as effect bar (still required):

| Id | Blueprint | Assert |
|----|-----------|--------|
| M1a | `input-click` | `#status` → `clicked` on Virtual |
| M1b | `input-forms` | `#field` value after `input` intent |
| M1c | `input-scroll` | `#scroller.scrollTop` after `scrollElement` |
| M1c+ | `input-scroll-components` | `#panel-list` / `#panel-feed` + page `scrollY` |
| M1c nested | `input-iframe-scroll` | nested `#inner-scroller.scrollTop` |
| M1d | `input-iframe-click` | inner `#inner-status` in nested context |

**Add / keep:** human Browse on a scrolling real site must activate by id (effect on Virtual), not by lucky pixel. Unit: `runPageProjectionInputClickUnitTests`.

Live MotorAssert / Sessions E2E = **cutover** ([roadmap.md](roadmap.md) gate 10), not a substitute for this contract.

---

## Explicit non-goals

| Item | Why |
|------|-----|
| Touch / pointer as separate OS intents | Projected is local on the user’s device — native touch/hover/`:active` |
| IME/composition, OS DnD onto dropzones, pixel caret sync | Deferred |
| `setFiles` completeness | Optional later; shape already id-required |
| Changing frame opcodes / apply for input | Forbidden by boundary |

---

## Implementation map

| Layer | Path |
|-------|------|
| Types | `@speculum/page-projection` / sidecar `intentTypes` |
| Virtual resolve | `projection/input/resolveVirtualNode.ts` |
| Dispatch | `projection/input/pageProjectionInputDispatch.ts` + `DomElementInput.ts` |
| Capture | `projected/input/projectedInputCapture.ts` |
| Session | `PageProjectionBrowserSession.pushInput` |
| Lab WS | `lab/host/protocol.ts` → `client.intent` |

---

## Provenance

V1 history and inject-chain / coalesce / bindings detail: [input.md](input.md). Where that file still implies “motion coords activate the click,” **this file wins**.

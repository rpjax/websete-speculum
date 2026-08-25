# PageProjection Input V2

**Status:** **SUPERSEDED on PP hot path (2026-08-25)** by OS unified input ([input-unified-design-draft.md](input-unified-design-draft.md), [input.md](input.md)). Kept as history of A/B/C CDP.  
**Was:** working design — not sealed. Normative enough to unblock Live/lab before OS cutover.  
**Boundary:** input is a **separate feature** — it must not change the frame algorithm (`virtual/**`, opcodes, apply/resync).

**Ruling 2026-08-25:** PP session = EventApplier + ABS uinput; Mode A/B CDP **removed** from hot path. Lab input E2E = Docker `/dev/uinput`.

**Ruling 2026-08-23 (A/B/C dispatch — historical LOCKED, now superseded for PP):** input is **fire-and-forget** and as cheap as possible.

| Mode | Intents | Mechanics |
|------|---------|-----------|
| **A** | `mousemove` / `pointermove`, `mousedown` / `mouseup` (+ pointer*), `wheel`, `keydown` / `keyup`, `scrollViewport` | CDP only. Coords / keys / viewport scroll. **Zero** resolve, frame walk, generation/sequence gate. Miss or wrong target because Virtual moved = **expected**. Payload `pointerType: 'touch'` → `Input.dispatchTouchEvent` (touch-primary client); otherwise mouse CDP. |
| **B** | `scrollElement`, `focus`, `blur`, `input` | Sidecar → **Control plane** `{ type: 'input', ... }` → Virtual `domNodes.get(nodeId)` → JS. O(1). Missing node = no-op. |
| **C** | **`setFiles` only** | CDP handle resolve + `setInputFiles` — rare exception. |

**SUPERSEDED:** 2026-08-22 id-assertive activate (resolve `nodeId` → bounding box → CDP press). That path must not run on A.

**Ruling 2026-08-22 (input = no sync):** the input plane **does not sync** with frame generation, apply, or resync. No `generation_stale`, no sequence gate, no sidecar copy of the identity table for input.

---

## Working status (2026-08-24) — not sealed

Enough to develop against. **Revisit before calling input done.**

### Landed (lab + package path)

| Piece | Notes |
|-------|--------|
| A/B/C dispatch | Mode A coords CDP; B Control→`domNodes`; C `setFiles` |
| Capture on Document + `onArmed` rebind | Survives in-place `<html>` replace / resync iframe swap |
| Mode A `pointerType` | Client stamps `PointerEvent.pointerType` (+ `pointerId`); sidecar: `touch` → `Input.dispatchTouchEvent`, else mouse |
| Touch vs sticky `:hover` | Mobile client remoting as mouse caused first-tap hover / second-tap activate; touch CDP is the designed fix |
| Lab MVP blueprints | click / forms / scroll / iframe variants (see MVP gates) |
| Paint parity for `<noscript>` | Client infrastructure (`scriptingOnPaintParity`) — not input plane; Constructable sheet with `<style>` fallback after EPOCH_RESET when `defaultView` briefly missing |

### Fine-tuning backlog (come back)

Not blockers for asset/canvas work; do **not** invent ad-hoc site rules.

| Item | Why it is still open |
|------|----------------------|
| Touch path polish on real sites | Confirm one-tap activate across menus/cards; multitouch / gesture edge cases |
| iOS native link activation | Sandboxed Projected may still navigate `<a href>` before remoted intent (lab 404) — needs a coherent suppress that does not break scroll/focus/coords |
| Coord / layout viewport on iOS | Visual vs layout viewport can desync touch mapping; keep Mode A mapping honest |
| Hybrid PC (touchscreen, `mobile: false`) | Finger → touch CDP; mouse → mouse; watch hover regressions |
| Mode B keyboard / IME / focus UX | Soft keyboard on mobile projected inputs |
| Unified input draft promotion | [input-unified-design-draft.md](input-unified-design-draft.md) still deferred (census, multitouch, ABS) |
| Live Sessions wire parity | Lab path proven; Hub/`PageProjectionIntent` + web capture must stay aligned with `pointerType` |

**Seal rule:** do not mark input SEALED until the fine-tuning rows above are closed or explicitly deferred with a decision-log row.

---

## Three planes

```text
Projected  ──intents──►  sidecar
                           ├─ A ──CDP Input/keyboard──► Virtual
                           ├─ B ──Control plane───────► Virtual.domNodes
                           └─ C ──CDP resolve+files───► Virtual
Virtual    ──frames──►  sidecar  ──DataPlane──►  Projected
Projected  ──control──►  sidecar  (requestResync, Mode B input, …)
```

Production: web/hub → sidecar. Lab: `client.intent` on lab WS.

---

## Intent envelope V2

| Field | Type | Notes |
|-------|------|-------|
| `schemaVersion` | u8 | `1` |
| `contextId` | u32 | Root = `1`. Mode B: producer applies only if `contextId === mine`. Mode A: journal; coords are **root viewport**. |
| `generation` | u32 | Journal/debug only — **not** a dispatch gate |
| `type` | string | See table — **no wire `click`** |
| `nodeId` | u32 \| null | **Required for B and C.** Mode A: optional journal only — dispatch **ignores** it |
| `timestampClient` | f64 | Optional |
| `payload` | JSON | Coords, keys, scroll, form values |

Hub DTO: [PageProjectionIntent.cs](../../Refactor/Speculum.Api/Sessions/Mirror/PageProjection/PageProjectionIntent.cs) (`targetId` = `nodeId`, `contextId` default `1`).

Sidecar **must not** maintain a passive replica of the Virtual identity table for input lookups.

---

## Dispatch primary (LOCKED 2026-08-23)

### Principle

Projected capture emits intents. Sidecar classifies A / B / C and injects. **No proof that the hit target matches `nodeId` on A.** Performance > safety nets; polish the product until races are rare enough — do not paper over with resolve.

### Per-type

| Type | Mode | `nodeId` | Primary |
|------|------|----------|---------|
| `mousedown` / `mouseup` / `pointerdown` / `pointerup` | **A** | ignored | CDP press/release at payload `(x,y)` (root viewport CSS px) |
| `mousemove` / `pointermove` | **A** | ignored | CDP `mouseMoved` at `(x,y)`; coalesce under inject-chain pressure |
| `wheel` | **A** | ignored | CDP wheel at `(x,y)` |
| `keydown` / `keyup` | **A** | ignored | CDP key → **current focus** on Virtual |
| `scrollViewport` | **A** | null | Absolute page `scrollX`/`scrollY` (CDP/evaluate viewport only — no element resolve) |
| `scrollElement` | **B** | **required** | Control → `el.scrollTop` / `scrollLeft` |
| `focus` / `blur` | **B** | **required** | Control → `el.focus()` / `blur()` |
| `input` | **B** | **required** | Control → value / checked + `input`/`change` |
| `setFiles` | **C** | **required** | CDP resolve handle → `setInputFiles` |

**No wire `click`.** Projected `click` / `contextmenu`: `preventDefault`; activation is down+up (A).

### Drop / ignore

| Condition | Behaviour |
|-----------|-----------|
| Wire `click` / `auxclick` | drop `ignored_wire_click` |
| Mode A invalid coords | drop `invalid_coords` |
| Mode A/C CDP failure | drop `cdp_error` |
| Mode B missing `nodeId` | drop `node_id_required` |
| Mode B node missing in `domNodes` | **no-op** (not a hard fail) |
| Mode C resolve miss | drop `anchor_missing` |

**Not drop reasons:** stale generation, sequence mismatch, “coord not on nodeId”.

### Nested documents

Mode **A:** capture maps nested event coords into **root Virtual viewport** before send. Sidecar never walks frames for A.  
Mode **B:** `contextId` selects the producer instance; that instance applies on its own `domNodes`.

---

## Coordinate space (Mode A)

1. **`surface`** = projection **stage** (1:1 Virtual viewport) — not `documentElement` scroll height.
2. Map event `clientX/Y` through stage → Virtual viewport CSS px; clamp.
3. Nested iframe: offset into root space **on the client**.
4. Speculum chrome outside the surface does not emit intents.

---

## Client capture

Module: [`projectedInputCapture.ts`](../../Refactor/packages/page-projection/src/projected/input/projectedInputCapture.ts).

- Listeners on Projected **Document** (capture); re-attach after resync iframe swap (`onArmed` again).
- **Armed** = local gate only. `click`/`submit`/`contextmenu` always `preventDefault` while attached.
- Move coalesce @ rAF; flush before down/up.
- Mode A payload includes `pointerType` / `pointerId` from `PointerEvent` (default `mouse`).
- Local-first scroll: do not `preventDefault` wheel; `scroll` → `scrollElement` / `scrollViewport`.
- Form edit: `markPropDirty(nodeId)` for Mode B `input`.
- Mode A may still stamp `nodeId` for journal; dispatch ignores it.
- Scroll echo on Mode B scroll apply (Virtual notes before mutate).

---

## Sidecar + Virtual

**A:** [`DomElementInput`](../../Refactor/sidecar/browser/patchright/mirror/dom/DomElementInput.ts) / dispatch — CDP mouse **or** touch (`pointerType`), key, viewport.  
**B:** `PageProjectionBrowserSession.sendControl({ type: 'input', contextId, intentType, nodeId, payload })` → Virtual Control handler → `domNodes.get`.  
**C:** resolve + `setInputFiles` only for `setFiles`.

**Forbidden on A:** `evaluateHandle` / `boundingBox` / `domNodes.get` via CDP / `findFrameForContext` / generation refresh.

Entry: `pushInput` / gRPC / lab `client.intent`. Lab `resolveAndClick` helpers may synthesize Mode A coords from a one-shot Virtual query for blueprints — that is **test harness**, not the live hot path.

---

## MVP gates (lab blueprints)

| Id | Blueprint | Assert | Mode |
|----|-----------|--------|------|
| M1a | `input-click` | `#status` → `clicked` | A |
| M1b | `input-forms` | `#field` value | B `input` |
| M1c | `input-scroll` | `#scroller.scrollTop` | B |
| M1c+ | `input-scroll-components` | panels + page `scrollY` | B + A |
| M1c nested | `input-iframe-scroll` | nested scroller | B |
| M1d | `input-iframe-click` | nested status | A (root-mapped coords) |

Unit: `runPageProjectionInputClickUnitTests` — Mode A coords activate. Live MotorAssert = cutover gate 10.

---

## Explicit non-goals

| Item | Why |
|------|-----|
| OS / uinput pointer (VideoStreaming stack) | Projected remotes CDP/Control only |
| Sidecar identity-table replica for input | Lookup for B lives in Virtual |
| Sequence / generation gates on intents | Fire-and-forget |
| Changing frame opcodes for input | Boundary |
| Site-specific hover / double-tap hacks | Use `pointerType` → touch CDP instead |

---

## Implementation map

| Layer | Path |
|-------|------|
| Types | `@speculum/page-projection` intent types |
| A + C | `pageProjectionInputDispatch.ts` + `DomElementInput.ts` |
| B Virtual | producer Control handler (`type: 'input'`) |
| Capture | `projectedInputCapture.ts` |
| Session | `PageProjectionBrowserSession.pushInput` / `sendControl` |
| Lab WS | `client.intent` |

---

## Provenance

V1 history: [input.md](input.md). Id-assertive activate (2026-08-22) is **historical**; this file’s A/B/C ruling wins.

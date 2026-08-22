# PageProjection Input V2

**Status:** **lab M1 closed 2026-08-20** — normative for cutover gate 6 ([roadmap.md](roadmap.md)). Supersedes unrevised sections of [input.md](input.md) for V4 / id-addressed intents.  
**Boundary:** input is a **separate feature** — it must not change the frame algorithm (`virtual/**`, opcodes, apply/resync).

## Three planes

```text
Projected  ──intents──►  sidecar (serial CDP chain)  ──►  Virtual
Virtual    ──frames──►  sidecar  ──DataPlane──►  Projected
Projected  ──control──►  sidecar  (requestResync, snapshot, …)
```

Production: web/hub → sidecar → CDP. Lab: `client.intent` on lab WS.

## Intent envelope V2

| Field | Type | Notes |
|-------|------|-------|
| `schemaVersion` | u8 | `1` |
| `contextId` | u32 | Same as frame header; root = `1` |
| `generation` | u32 | Match applied frame generation |
| `type` | string | `mousemove`, `mousedown`, `mouseup`, `input`, `scrollViewport`, `scrollElement`, … — **no wire `click`** |
| `nodeId` | u32 \| null | Target via client registry / sidecar `domNodes.get` |
| `timestampClient` | f64 | Optional |
| `payload` | JSON | Coords, keys, scroll, form values |

Hub DTO: [PageProjectionIntent.cs](../../Refactor/Speculum.Api/Sessions/Mirror/PageProjection/PageProjectionIntent.cs) (`targetId` = `nodeId`, `contextId` default `1`).

## Client capture

Module: [`projectedInputCapture.ts`](../../Refactor/packages/page-projection/src/projected/input/projectedInputCapture.ts) (shared projected) / [`interaction.ts`](../../Refactor/web/src/features/sessions/live/page/interaction.ts) (prod legado until gate 10).

- Listeners on **Projected surface** only (plus `document` / `window` for viewport `scroll`).
- **Armed** after resync CHECK + generation match; **zero intents** while disarmed.
- Move coalesce @ rAF; flush before down/up.
- Local-first scroll: do not `preventDefault` wheel — overflow paints; `scroll` → `scrollElement` / `scrollViewport`.
- `preventDefault` on synthetic click/contextmenu.
- Form edit: `markPropDirty(nodeId)` → existing `FormPropDirty` skip on upstream `PROP_SET`.
- Cross-realm: never `instanceof HTMLElement` from the lab/shell Window against Projected nodes — use `nodeType` / `tagName`.

## Sidecar dispatch

Module: [`v4InputDispatch.ts`](../../Refactor/sidecar/browser/mirror/projection/input/v4InputDispatch.ts) wrapping [`DomElementInput.ts`](../../Refactor/sidecar/browser/patchright/mirror/dom/DomElementInput.ts).

1. Validate generation (stale → drop).
2. Resolve `(contextId, nodeId)` → Virtual element via `__speculumProjection.domNodes.get` in the correct frame.
3. Nested mouse/wheel coords: frame-local → page via iframe `boundingBox` before CDP.
4. Map surface coords → viewport; CDP `mouseMoved` → `mousePressed` → `mouseReleased`.

Entry: `V4ProjectionBrowserSession.pushDomInput` / gRPC `PushDomInput` / lab `client.intent`.

## MVP gates (lab blueprints) — closed

| Id | Blueprint | Assert |
|----|-----------|--------|
| M1a | `input-click` | `#status` → `clicked` on Virtual |
| M1b | `input-forms` | `#field` value after `input` intent |
| M1c | `input-scroll` | `#scroller.scrollTop` after `scrollElement` |
| M1c+ | `input-scroll-components` | `#panel-list` / `#panel-feed` + page `scrollY` |
| M1c nested | `input-iframe-scroll` | nested `#inner-scroller.scrollTop` (`contextId` ≠ root) |
| M1d | `input-iframe-click` | inner `#inner-status` in nested context |

Human eye: fixture `input-scroll-matrix` (Browse) — wheel page / panels / iframe; bands must glide under sticky bars.

Unit: `runV4InputClickUnitTests` in sidecar (`npm run unit`).

Live MotorAssert / Sessions E2E = **cutover** ([roadmap.md](roadmap.md) gate 10), not input development.

## Explicit non-goals

| Item | Why |
|------|-----|
| Touch / pointer as separate OS intents | Projected is a **local** document on the user’s device — touch, hover, and CSS `:active` are **native**. Capture already uses pointer events; no second touch plane. |
| IME/composition, OS DnD onto dropzones, pixel caret sync | Deferred; not required to close gate 6. |
| `setFiles` | Optional later; not M1. |

## Implementation map

| Layer | Path |
|-------|------|
| Types | `projection/input/intentTypes.ts` |
| Virtual resolve | `projection/input/resolveVirtualNode.ts` |
| Dispatch | `projection/input/v4InputDispatch.ts` |
| Capture | `@speculum/page-projection` `projected/input/projectedInputCapture.ts` / [`interaction.ts`](../../Refactor/web/src/features/sessions/live/page/interaction.ts) (prod legado until gate 10) |
| Session | `V4ProjectionBrowserSession.pushDomInput` |
| Lab WS | `lab/host/protocol.ts` → `client.intent` |

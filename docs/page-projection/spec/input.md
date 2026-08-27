# PageProjection — OS unified input

**Status:** **SEALED** 2026-08-26 (Rodrigo) — OS unified hot path; Phase A + lab resolve = loopback invoke only.  
**Bar:** lab Docker `/dev/uinput` effect oracles ([LAB-DOCKER.md](../../Refactor/sidecar/LAB-DOCKER.md)). **PASS** — see §6.  
**Design provenance:** [input-unified-design-draft.md](input-unified-design-draft.md).  
**Superseded:** [input-v2.md](input-v2.md) Mode A/B/C CDP — purged.  
**Index:** [README.md](README.md). Frame identity: [frame-protocol.md](frame-protocol.md). Loopback mux: draft §10.1c / D-UI-28.

> **2026-08-26:** False “SEAL v0” (CDP MAIN producer RPC) reverted same day. This seal follows loopback Phase A, LB-03 resolve, S6 ContextBus RPC, and Docker gates green.

---

## 1. One-liner

```
Projected capture → UnifiedIntent (+ S6 census on down/up)
  → wire → SidecarBuffer → EventApplier
       ├─ Phase A: loopback invoke applyScrollCensus / applyScrollSet → Virtual RUNTIME (MAIN)
       └─ Phase B: ABS uinput → Chromium on Xorg Display
```

Fail-closed without `/dev/uinput`. No CDP Mode A/B. Input does **not** gate on frame generation/resync.

**Law — sidecar ↔ Virtual RPC:** page loopback WebSocket only (`kind: invoke` / `invoke-result`). Not CDP `Runtime.evaluate`. Not Patchright `page.evaluate` / `frame.evaluate` (isolated world — and isolate does **not** offload MAIN; census/apply already run in MAIN inside the producer).

---

## 2. Pipeline (LOCKED)

| Stage | Law |
|-------|-----|
| ClientBuffer | Move coalesce 50ms (last wins); no flush before down/up. Scroll coalesce 100ms per target. |
| Wire | MessagePack lean envelope `schemaVersion=1`. Types: `move\|down\|up\|keyDown\|keyUp\|scrollSet\|setFiles`. |
| SidecarBuffer | Ordered; drop oldest under pressure; never drop/coalesce down/up. |
| EventApplier | Serial consumer. Routes by type. PP down/up require census; Phase A fail ⇒ skip Phase B. |
| Pointer | ABS only (no REL). Click = moveTo + press/release. Out-of-window stamp → drop. |
| Keyboard | keyDown/keyUp stream + modifiers; fixed keymap → KEY_*. No IME v0. |
| Scroll | Fine contract `scrollSet` only. Wheel dead on Virtual. |
| Upload | `setFiles` stub v0 (accept, no real apply) until v1.1. |

---

## 3. Coordinates

- Intents carry **client CSS** coords stamped with `viewportW`/`viewportH`.
- **F(x) (LOCKED):** `mapLogicalToAbs` — client `(x,y)` maps **1:1** into ABS (`createLogicalWindowTransform(W,H)` ⇒ absMax = W−1,H−1). No chrome-inset calibration. No CDP probe.
- Launch/resize geometry: `applyNativeWindowBounds` places the **content** box at display (0,0) size W×H (chrome pushed off-screen). That is window setup, not input-path calibration.
- Display+ABS for cutover = session logical W×H (identity). Soft-resize over-alloc R = D-UI-05/11 later.
- Nested iframe pointers: client maps to **root viewport** before enqueue.

---

## 4. S6 scroll↔click

- Projected maintains scrollable index; census on **down and up**.
- **Projected census path:** ContextBus **`invoke` `snapshotScrollPositionsFromAllContexts`** on RUNTIME from the emitting context; RUNTIME fans out **`snapshotScrollPosition`** per registered context (draft §10.1b). Same path lab and product — no same-origin DOM walk.
- **Registry law:** `ProjectedInputRuntime.registry` must only list contexts with a live bus. Nested host **drop before `load` bind** MUST cancel the pending listener ([multi-document.md](multi-document.md) §4.1) — otherwise late bind registers a ghost id; census includes it; Phase A Virtual apply times out (~2000ms) or click never reaches ABS. Fixed 2026-08-27 (`cancelPendingNestedHost`).
- Sidecar Phase A: loopback **`invoke` `applyScrollCensus`** (args `{ census }`) → Virtual RUNTIME fan-out → `invoke-started` / `invoke-heartbeat` (reset idle) → `invoke-result`. Idle timeout **2000ms** (LB-04), same heartbeat rule as ContextBus.
- Fine scroll: loopback **`invoke` `applyScrollSet`**.
- Phase A fail ⇒ do **not** Phase B ABS click.
- Lab journal `intent ok:true` means the sidecar **accepted/enqueued** the intent — **not** that Phase A succeeded (Applier may reject without throwing).

---

## 5. Loopback invoke catalog (sidecar → Virtual)

Carrier: draft §10.1c. Expand only by decision. Closed list for this cutover:

| `name` | Args | Result | Used by |
|--------|------|--------|---------|
| `applyScrollCensus` | `{ census: ScrollCensus }` | `{ ok, reason?, missingNodeIds? }` | Applier Phase A |
| `applyScrollSet` | `{ contextId, nodeId, scrollX, scrollY }` | `{ ok, reason? }` | Applier `scrollSet` |
| `keyOfSelector` | `{ selector, contextId? }` | `{ ok, nodeId?, reason? }` | lab `resolveAndScrollElement` |
| `resolveElementHit` | `{ selector, contextId? }` | `{ ok, x?, y?, scrollX?, scrollY?, nodeId?, reason? }` | lab `resolveAndClick` / type |
| `haltWorld` | `{}` | `{ ok, reason? }` | lab / session |
| `resumeWorld` | `{}` | `{ ok, reason? }` | lab / session |
| `flushFrame` | `{}` | `{ ok, generation?, sequence?, reason? }` | lab / session |
| `snapshotContext` | `{ contextId, includeTree?, cssom? }` | snapshot result | lab / `getStateSnapshot` |

`requestResync` stays fire-and-forget Control (`__control` / PlaneChannel.Control) until moved by a separate decision. Lab `resolveAnd*` uses **`keyOfSelector` / `resolveElementHit`** only — never CDP MAIN for producer RPC.

**Virtual resolve drain (LOCKED):** handlers for `keyOfSelector` and `resolveElementHit` MUST call **this context’s** `frameEmitter.flushNow()` before `domNodes.keyOf` / hit math. Sync MO→identity drain; emits a frame on the wire only if that context has pending DOM/CSSOM work (`flushNow` does not await Projected apply). Nested resolve uses the nested context emitter — root `flushFrame` is not a substitute.

---

## 6. Lab proof (sealed)

| Gate | Evidence | Status |
|------|----------|--------|
| D-UI-20 spike | `npm run lab:docker:spike` — ABS hit-test 1:1 | **PASS** 2026-08-26 |
| Input suite | `npm run lab:input-suite:docker` — click, forms, scroll, iframe, stress | **PASS 8/8** 2026-08-26 |
| Accept same-origin | `docker compose … exec lab node scripts/accept-fixtures-sameorigin.js` | **PASS** 2026-08-26 |

Sealed on effect oracles above — producer RPC path is loopback only (no CDP MAIN).

---

## 7. Explicitly out of this cutover / future seal

| Item | Status |
|------|--------|
| Touch / multitouch | DEFERRED |
| IME / insertText | DEFERRED |
| Real `setFiles` apply | v1.1 |
| VideoStreaming AbsOs / drop `SPECULUM_INPUT_BACKEND` | separate cut |
| Fine-tuning (iOS link suppress, touch polish) | after assets |
| MotorAssert Live PP intents | gate 10 compose |
| Chrome inset calibration / ABS screen offset | TEMP #3–4 — not input law |

---

## 8. Vocabulary

| Term | Meaning |
|------|---------|
| **UnifiedIntent** | Wire/session intent (`move`/`down`/`up`/keys/`scrollSet`/`setFiles`) |
| **EventApplier** | Serial sidecar dispatcher |
| **Census** | Scroll positions snapshot (S6) on PP down/up |
| **ABS** | Absolute uinput pointer (no REL move path) |
| **Loopback invoke** | Sidecar↔Virtual RPC on page WS (`invoke` / `invoke-result`) |
| **Node id** | `uint32` from frame identity map — no `speculum-anchor` attribute |

---

## 9. Related code

- Capture: `Refactor/packages/page-projection/src/projected/input/projectedInputCapture.ts`
- S6 census runtime: `Refactor/packages/page-projection/src/projected/input/projectedInputRuntime.ts`
- Nested host install/drop (cancel pending load): `Refactor/packages/page-projection/src/projected/ProjectionClient.ts` (`cancelPendingNestedHost`)
- Session: `Refactor/sidecar/browser/mirror/projection/session/PageProjectionBrowserSession.ts`
- Applier: `Refactor/sidecar/browser/input/EventApplier.ts`
- ABS stack: `Refactor/sidecar/browser/input/AbsOsInputStack.ts`
- Lab ghost repro: `Refactor/sidecar/scripts/diag-click-ghost-context.js`
- Loopback mux: `Refactor/packages/page-projection/src/core/loopback/envelope.ts`

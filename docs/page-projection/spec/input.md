# PageProjection — input

**Status (codebase, 2026-08-27):** **sparse-cdp only** — id-addressed click via CDP, no OS ABS, no S6 census on the hot path. See §2.1a / decision-log.md.

**Historical (below):** The body of this file (§1–§9 ABS uinput + S6 census + Display fail-closed) is **development history** — the sealed OS unified design from 2026-08-26. It is **not** implemented in the current codebase. Reopen only with an explicit redesign + decision-log row. Design provenance: [input-unified-design-draft.md](input-unified-design-draft.md). Superseded CDP Mode A/B/C: [input-v2.md](input-v2.md).

**Bar today:** lab Docker effect oracles on sparse-cdp + real-site (Eneba) validation. Display/Xorg may still start for headed Chrome; PP input itself does **not** require `/dev/uinput`.

**Lab proof (sparse-cdp V1 — 2026-08-27):** Docker blueprints **9/10 PASS** — `input-click`, `input-forms`, `input-forms-keycode`, `input-forms-enter`, `input-scroll`, `input-scroll-components`, `input-iframe-scroll`, `input-stress`, `input-e2e-stress`. `input-iframe-click` nested `contextId=2` → `keyOfSelector` **`node_unmapped`** (open follow-up; root + real-site paths proven). `input-forms` may flake `Target.createTarget` on back-to-back cold boots — PASS on isolated retry (lab infra). **Real-site:** Eneba search/space/overlay dismiss validated (Rodrigo). Sidecar `npm run unit` green.

---

## Canonical pipeline (2026-08-27+)

```
Projected capture (sparse: event.target → idOf, no pointermove stream)
  → UnifiedIntent (down/up + nodeId/contextId; keyDown/keyUp; scrollSet; historyNav)
  → wire → SidecarBuffer → EventApplier
       ├─ click: loopback resolveNodeHit(nodeId + x/y) → validate in live bounds → CDP at pointer
       ├─ keyboard: intent.key → page.keyboard.down/up (ASCII + editing keys); non-ASCII → insertText
       ├─ history: page.goBack / page.goForward on Virtual
       └─ scroll: loopback applyScrollSet → Virtual applyScrollPositions
```

No census fan-out. No ABS uinput. No `os-abs` adapter.

---

<details>
<summary>Historical OS unified input seal (2026-08-26) — record only, not current code</summary>

# PageProjection — OS unified input (HISTORICAL)

**Status:** **SEALED** 2026-08-26 (Rodrigo) — OS unified hot path; Phase A + lab resolve = loopback invoke only.  
**Bar:** lab Docker `/dev/uinput` effect oracles ([LAB-DOCKER.md](../../sidecar/LAB-DOCKER.md)). **PASS** — see §6.  
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

### 2.1 Adapter port (2026-08-27, canonical default flipped 2026-08-27)

`PageProjectionBrowserSession.launch()` composes input through a set of small, single-purpose
ports, not a hardcoded stack and not one fat "everything an adapter might need" interface —
[decision-log.md](decision-log.md) 2026-08-27 ("contracts decomposed") corrected an earlier,
rejected `InputAdapterLaunchProfile` draft that bundled precondition-check + display-device +
construction-timing + click-wiring into a single interface.

- **`kind`:** `'sparse-cdp'` (`sidecar/browser/input/adapters/sparseCdpInputAdapter.ts`)
  is the **canonical default** (2026-08-27 Rodrigo explicit ruling — `PP-INPUT-VIRTUAL-MINT-GHOST`
  plus severe main-thread stalls on real sites made the census-coordinated `os-abs` path
  untenable as the default). `'os-abs'`
  (`sidecar/browser/input/adapters/osAbsInputAdapter.ts`) is **frozen legacy** — opt-in
  only via `BrowserLaunchOptions.pageProjectionInputAdapterKind: 'os-abs'` / lab CLI
  `--input-adapter os-abs`, kept for reference/rollback, not extended or perf-fixed. Never an
  env var, either direction.
- `sidecar/browser/input/ports.ts`:
  - `IInputAdapter` — universal, both kinds implement it: `{ kind, pointer, keyboard,
    setLogicalSize(), dispose() }`. Nothing about scroll, click addressing, or display binding —
    those are separate contracts below (a dead `IScrollApplier`/`IFileUploadApplier`/`scroll?`
    surface that nothing ever implemented was deleted in the same pass).
  - `IDisplayInputDeviceProvider` — narrow, optional capability, `{ displayInputDevices() }`.
    Only `os-abs` implements it (real kernel uinput devices Xorg must bind before it starts).
    `sparse-cdp` has no kernel device at all and does not implement a stub for it — a capability
    you don't have is absent, not faked (a fake stub returning empty device paths used to live
    on `sparse-cdp` purely to satisfy the old fat `IInputAdapter`; deleted). Type guard:
    `hasDisplayInputDevices(adapter)`.
- `sidecar/browser/input/clickDelivery.ts` — `ClickDeliveryStrategy` (discriminated
  union: `'census-coordinated'` | `'live-node-resolve'`, see §2.1a/§4). Orthogonal to
  `IInputAdapter`: "how to move the pointer" and "how to decide where to click" are independent
  choices that happen to pair 1:1 with adapter kind today, composed by
  `PageProjectionBrowserSession.launch()`, not baked into either adapter.
- `sidecar/browser/input/createInputAdapter.ts` — `createInputAdapter(kind, opts): IInputAdapter`.
  Both kinds are built at the **same single call site** in `launch()`, before `Display.start()` —
  there is no adapter-specific "construct before/after Chrome" lifecycle hook. `sparse-cdp`'s
  `cdp.send` is a lazy closure through `currentCdpSession()`, invoked only on an actual
  dispatch (never before `launchChrome()` resolves), so building the wrapper before Chrome even
  exists is safe; `os-abs` has a real ordering need (its uinput device paths must exist before
  Xorg's config is written), which this single call site already satisfies for free. There is no
  separate "environment precondition" contract either: `AbsOsInputStack.open()` (called only for
  `os-abs`) throws `errorCode: 'uinput_unavailable'` if `/dev/uinput` is missing, at construction
  time — fail-fast is a property of that one constructor, not a cross-cutting check the session
  runs for every kind. Lab Docker effect-oracle proof (click/type/scroll, real DOM state
  assertion) green — [decision-log.md](decision-log.md) 2026-08-27 (proof entry). Full blueprint
  catalog (click/forms/scroll/scroll-components/iframe-click/iframe-scroll/stress/e2e-stress)
  reverified green after a distinct-target click-coordinate race fix —
  [decision-log.md](decision-log.md) 2026-08-27 (e2e-stress finding). **Not yet measured:**
  latency/throughput percentiles, sustained-load or multi-session concurrency, resource
  (CPU/memory) behaviour — the lab blueprints above assert functional DOM correctness only,
  not performance; do not read "stress blueprint green" as a performance/capacity claim.
- `sidecar/browser/input/os/eventNodes.ts` — shared `listInputHandlers` /
  `ensureInputEventNodes` (dedupe of the identical helpers PP/ABS and Video/REL each carried).

### 2.1a `sparse-cdp` id-addressed click — canonical default's click delivery (2026-08-27)

**Scope:** `sparse-cdp` only (now the default, §2.1). `os-abs` is unchanged and keeps §3/§4
(coordinate + S6 census) exactly as sealed, frozen, opt-in only. Two `ClickDeliveryStrategy`
variants now coexist behind `EventApplier` (§2.1, `clickDelivery.ts`); this section documents
`'live-node-resolve'`, it does not amend `'census-coordinated'` (§4) —
[decision-log.md](decision-log.md) 2026-08-27 (Rodrigo explicit ruling: discard census/sync for
`sparse-cdp`, keep `os-abs` sealed).

- Projected `attachProjectedInputCapture`'s `sparse` capture policy (§2.1, previously
  pointermove-only) also skips scroll census on `down`/`up`: it resolves the click target from
  **`event.target`** via `registry.idOf(target)` (exact match — **no** `idOfNearest`, **no**
  `elementFromPoint`) and sends the result as `PointerIntent.nodeId`/`contextId` (new optional
  wire fields — `unifiedIntentTypes.ts`; `os-abs` never sets them, `ingressToUnifiedIntent.ts`
  pass-through is a harmless no-op for it). **Registry miss → skip** (`metrics.skippedNoNodeId`);
  no intent with `nodeId: null` is emitted from capture.
- `EventApplier.applyOne`'s `down`/`up` case switches exhaustively on `clickDelivery.mode`
  (`clickDelivery.ts`; `PageProjectionBrowserSession.launch()` wires exactly one strategy per
  `inputAdapterKind`): `'live-node-resolve'` + `nodeId != null` → resolve via Virtual RPC
  `resolveNodeHit` (§5) with client `(x,y)` — validates point inside live node bounds,
  dispatches CDP there; **`nodeId == null` →
  reject `missing_node_id` / phase `validate`** — fail-closed, no raw-coordinate fallback.
- Lab/CLI proof helper: `PageProjectionBrowserSession.resolveAndClickDomInputByNodeId(selector,
  contextId)`, sibling to `resolveAndClickDomInput` but addressing by nodeId. Root-context proof
  green in Docker (`scripts/scratch/diag/diag-nodeid-click.js`) via real DOM state read, not a
  protocol signal. **Nested context (`contextId>1`) not independently re-proven this pass** —
  `requestResolveNodeHit` mirrors `requestResolveElementHit`'s addressing exactly (same
  `isDeliverableDestination` guard, same `bus.invoke` shape), and the official
  `input-iframe-click` blueprint (coordinate path, same addressing machinery) is green under
  `sparse-cdp`, but that is inference by shared code, not a direct proof of `resolveNodeHit`
  itself at `contextId>1`.
- Interactive lab UI (`http://127.0.0.1:4103/`) can pick the adapter per Browse session now, not
  only via the CLI blueprint runner: `client.html`'s `inputAdapter` `<select>` →
  `browse.start.inputAdapter` → `chassis.boot({ inputAdapterKind })`; `session.booted` echoes it
  back so `main.ts` sets `capturePolicy: 'sparse'` on the client capture to match.
- Not a fix for `PP-INPUT-VIRTUAL-MINT-GHOST` (open.md): `resolveNodeHit` targets exactly the one
  context the hit-test named, not a `Promise.all` fan-out over every known context, so an
  unrelated dead ad iframe elsewhere on the page can no longer hang an unrelated `sparse-cdp`
  click — but the bug is still fully live for the frozen `os-abs` legacy path.

---

## 3. Coordinates

- Intents carry **client CSS** coords stamped with `viewportW`/`viewportH`.
- **F(x) (LOCKED):** `mapLogicalToAbs` — client `(x,y)` maps **1:1** into ABS (`createLogicalWindowTransform(W,H)` ⇒ absMax = W−1,H−1). No chrome-inset calibration. No CDP probe.
- Launch/resize geometry: `applyNativeWindowBounds` places the **content** box at display (0,0) size W×H (chrome pushed off-screen). That is window setup, not input-path calibration.
- Display+ABS capacity is over-alloc **R** (`viewportPolicy.maxWidth`/`maxHeight`, D-UI-04/11) — session logical W×H is a **soft-resizing subset** of that R, not an identity display size (`PageProjectionBrowserSession.launch()`). **Corrected 2026-08-27** — this line previously said cutover capacity was identity W×H with over-alloc R as D-UI-05/11 future work; R-as-launch-capacity already shipped, this was stale prose only (no behavior change).
- Nested iframe pointers: client maps to **root viewport** before enqueue.

---

## 4. S6 scroll↔click

**Scope: `os-abs` only (sealed, frozen legacy — not the default).** `'census-coordinated'`
`ClickDeliveryStrategy` (§2.1). `sparse-cdp` (canonical default) uses `'live-node-resolve'`
instead and discards this section entirely — see §2.1a.

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
| `resolveNodeHit` | `{ nodeId, x?, y?, contextId? }` | `{ ok, x?, y?, reason? }` | `sparse-cdp`'s `'live-node-resolve'` — id + pointer coords (center fallback when x/y omitted) |
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
| Continuous pointer move / hover / drag on the `sparse-cdp` adapter | Accepted gap **specific to `sparse-cdp`** (2026-08-27) — click/keys/scroll/upload catalog only. Does **not** regress the frozen `os-abs` legacy path, which still streams every `move` intent unchanged. |
| IME / composition / `beforeinput` on Projected | DEFERRED (no IME v0) — keyboard is `keyDown`/`keyUp` + `insertText` for single code units |

**Sparse keyboard (2026-08-27):** wire canonical = **`intent.key`** (not `UIEvent.code` — `KeyA` must not be dispatched as-is). Projected capture **`preventDefault`s editable targets** (`INPUT`/`TEXTAREA`/`SELECT`/`contenteditable`) so Virtual is the sole mutator. Sidecar: ASCII printable + editing/special keys → lazy `page.keyboard.down/up` (PatchrightInputBackend shape); non-ASCII single code unit → `Input.insertText`. Lab proof: `input-forms-keycode`, `input-forms-enter` blueprints.

**History nav (2026-08-27):** `historyNav` intent (`back`/`forward`) — Projected capture blocks local history (`preventDefault` on shortcuts; `popstate` trap; touch edge-swipe) and forwards to Virtual `page.goBack`/`goForward`. Wire aliases: `goback`/`goforward`.

**Click coords (2026-08-27):** `resolveNodeHit` receives client `(x,y)` + `nodeId`; Virtual validates the point is inside the live element bounds and returns the same coords for CDP (not element center). Lab helpers without coords still fall back to center. **Space:** never `.trim()` `intent.key` — `' '` maps to Playwright `Space`.

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

- Capture: `packages/page-projection/src/projected/input/projectedInputCapture.ts`
- S6 census runtime: `packages/page-projection/src/projected/input/projectedInputRuntime.ts`
- Nested host install/drop (cancel pending load): `packages/page-projection/src/projected/ProjectionClient.ts` (`cancelPendingNestedHost`)
- Session: `sidecar/browser/mirror/projection/session/PageProjectionBrowserSession.ts`
- Applier: `sidecar/browser/input/EventApplier.ts`
- ABS stack: `sidecar/browser/input/AbsOsInputStack.ts`
- Lab ghost repro: `sidecar/scripts/diag-click-ghost-context.js`
- Loopback mux: `packages/page-projection/src/core/loopback/envelope.ts`
- Loopback establish (normative): [loopback.md](loopback.md)

</details>

# PageProjection — decision log (append-only)

**Rule:** to reverse a decision, **append a new row**. Do not edit history.  
**Filename:** `decision-log.md` (not `DECISIONS.md`) so Windows does not collide with `archive/DECISIONS.md`.  
**V4 protocol narratives** (long form) live in [frame-protocol.md](frame-protocol.md) “Decision log” — that table is canonical for 2026-08-13+ protocol work. **This file** is the cross-era index plus every D-SPEC / E-* / Q-* row so nothing is lost when archive files are ignored.

**Who decides:** Rodrigo. Agents present options; they do not mark `DECIDED` on architecture without him.

---

## How to append

1. Protocol behaviour → add a row to [frame-protocol.md](frame-protocol.md) decision log **and** a one-line index row in §A below.
2. Process / cutover / ruling → [open.md](open.md) + a row in §A.
3. Never revive a row marked **SUPERSEDED BY V4**.

---

## A. Index — V4 era (2026-08-13+)

| Date | Topic | Where the full text is |
|------|-------|------------------------|
| 2026-08-27 | **`sparse-cdp` becomes the canonical default, `os-abs` frozen — Rodrigo explicit ruling** ("A PORRA DO INPUT NÃO DEVERIA TER CENSUS, NÓS MUDAMOS PRA VERSÃO ALTERNATIVA; TIRE COMPLETAMENTE A VERSÃO VIA OS E DEIXE O CÓDIGO CONGELADO. A PORRA DO CAMINHO CANONICO PRA ESSE MOMENTO É A VERSÃO MINIMALISTA QUE ACABAMOS DE CRIAR"), issued after real-site testing (eneba.com) reconfirmed `os-abs`'s pre-existing `PP-INPUT-VIRTUAL-MINT-GHOST` click-death bug plus severe main-thread stalls unrelated to input. Every default that previously read `?? 'os-abs'` now reads `?? 'sparse-cdp'`: `PageProjectionBrowserSession.launch()`'s `inputAdapterKind`, `LabChassis.inputAdapterKind`/`boot()`, `wsSession.ts`'s `browse.start` fallback (now sourced from `chassis.getInputAdapterKind()` — the resolved kind — instead of re-echoing the client's possibly-absent raw field), the lab UI's `client.html` `<select>` and `main.ts`'s `activeInputAdapter`. `os-abs` remains fully present and functional (opt-in via `pageProjectionInputAdapterKind: 'os-abs'` / lab CLI `--input-adapter os-abs`) but is now documented FROZEN LEGACY in its own file headers (`osAbsInputAdapter.ts`, and by reference `AbsOsInputStack.ts`) — kept for reference/rollback, not to be extended or perf-fixed. Rodrigo separately rejected a first redesign attempt (`InputAdapterLaunchProfile`, a single fat interface bundling precondition-check + display-device + construction-timing + click-wiring) as "tentando fazer um monte de coisa caber na mesma caixa" with implementation detail leaking into the contract; this entry is the corrected, decomposed replacement — see the architecture entry immediately below. | `PageProjectionBrowserSession.ts` · `BrowserSession.ts` · `LabChassis.ts` · `wsSession.ts` · `client.html` · `main.ts` |
| 2026-08-27 | **Input adapter contracts decomposed — one semantic question per interface, no adapter-kind names or launch-sequence timing baked into any of them** (companion to the canonical-default ruling above). Concrete changes: (1) `IInputAdapter` (`ports.ts`) trimmed to the universal capability only — `pointer`/`keyboard`/`setLogicalSize`/`dispose`; `displayInputDevices()` removed from it (a fake stub returning empty device paths used to live on `sparse-cdp`'s adapter object purely to satisfy this interface — a contract nobody can meaningfully satisfy is itself a bug, not a detail to paper over). (2) New narrow, optional capability `IDisplayInputDeviceProvider` + structural type guard `hasDisplayInputDevices()` — only `os-abs` implements it (real kernel uinput devices Xorg must bind before it starts); `sparse-cdp`'s object no longer implements it at all. (3) New `ClickDeliveryStrategy` discriminated union (`clickDelivery.ts`, `'census-coordinated' \| 'live-node-resolve'`) replaces the previous loose independently-optional pair `applyScrollCensus?`/`resolveClickTarget?` on `EventApplierOptions` — those two were never meant to coexist (exactly one wired per kind) but a pair of optionals cannot express or enforce that; `EventApplier.applyOne`'s `down`/`up` case now does an exhaustive `switch` on `.mode` instead of an `if (this.opts.resolveClickTarget)` truthy-duck-type check. Click *addressing* (where to click) is deliberately modeled as independent from `IInputAdapter` (how to move the pointer once you know where) — today's kinds each pair with exactly one strategy, but that pairing is a session-level composition choice (`PageProjectionBrowserSession.launch()`), not a property of the adapter itself. (4) Construction collapsed to **one point** for both kinds, removing the "before/after Chrome" phase split entirely: re-reading `sparseCdpInputAdapter.ts` showed `cdp.send` is already a 100%-lazy closure through `currentCdpSession()`, invoked only on an actual pointer/keyboard dispatch — which never happens before `launchChrome()` resolves — so constructing the `sparse-cdp` wrapper before Chrome even exists is provably safe; there was never a genuine ordering constraint for it, only an incidental one from when it was first bolted on. `os-abs` still has a real, unavoidable constraint (its uinput device paths must exist before `Display.start()`'s Xorg config is written), so both kinds now build at that same single call site — no adapter-specific lifecycle-hook interface needed at all. (5) Removed the top-of-`launch()` unconditional `uinputAvailable()` precondition gate — `AbsOsInputStack.open()` already throws the identical `errorCode: 'uinput_unavailable'` internally, so the top-level copy was pure duplication that additionally ran even for `sparse-cdp`, which never needs uinput; no replacement "precondition contract" was needed, the guard just moved to the one constructor that actually cares, for free, by virtue of (4). (6) Deleted dead `IScrollApplier`/`IFileUploadApplier` interfaces and `IInputAdapter.scroll?` — grepped confirmed zero implementations across both adapters (one unit test even asserted `adapter.scroll === undefined`); speculative contracts nobody satisfies are exactly the kind of cruft this pass was meant to remove, not preserve for hypothetical future use. (7) Fixed a live bug found while touching this code: `getInputBackend()`'s ternary had both branches returning `'os'` (`kind === 'os-abs' ? 'os' : 'os'`) — now `'os' \| 'cdp'` sourced honestly from `kind`; widened the downstream lab telemetry literal (`LabIntentJournalEntry.mode`, `wsSession.ts`'s `timingOf()`) from `'A'\|'B'\|'C'\|'OS'` to add `'CDP'` so a `sparse-cdp` run's journal no longer mislabels itself `'OS'`. Full sidecar build + `npm run unit` green (100% pass) after all of the above — zero behaviour change intended for `os-abs` beyond the default flip and the dead-code removal, which touches nothing it does at runtime. | `Refactor/sidecar/browser/input/ports.ts` · `clickDelivery.ts` (new) · `EventApplier.ts` · `EventApplier.unit.ts` · `adapters/osAbsInputAdapter.ts` · `adapters/sparseCdpInputAdapter.ts` · `adapters/sparseCdpInputAdapter.unit.ts` · `PageProjectionBrowserSession.ts` |
| 2026-08-27 | **`sparse-cdp` click goes id-addressed (nodeId), discards S6 census entirely — Rodrigo explicit ruling** ("essa é uma versão alternativa da pipeline de input... descarte toda lógica de census e sync desnecessária; vamos deixar o mais otimizado possível. Porém deixe devidamente anotado. Nós não estamos jogando a spec atual fora, estamos dando suporte a mais de uma implementação"). This **supersedes, for `sparse-cdp` only**, the D-UI-30 discard ("Sidecar identity-table replica / nodeId resolve on peripheral hot path") and exempts `sparse-cdp` from the S6 scroll↔click coherence law (D-UI-26, [input-unified-design-draft.md](input-unified-design-draft.md)) and from D-UI-03's coordinate-only click shape. **`os-abs` is untouched** — still census+coordinate, still LOCKED, zero lines of its code path changed. Two pipelines now coexist behind the same `IInputAdapter`/`EventApplier` boundary; this is explicitly *not* a spec rewrite. Mechanism: Projected `attachProjectedInputCapture`'s existing `sparse` capture policy (previously pointermove-only) now also skips `requestScrollCensus`/`snapshotScrollCensus` on `down`/`up` and instead calls `doc.elementFromPoint(clientX, clientY)` + `registry.idOfNearest(el)` to hit-test a `nodeId` locally, sent on the wire as `PointerIntent.nodeId`/`contextId` (new optional fields, `os-abs` never sets them). `EventApplier.applyOne`'s `down`/`up` case gained a new `resolveClickTarget` branch, mutually exclusive with `applyScrollCensus` on a given instance (`PageProjectionBrowserSession.launch()` wires exactly one, keyed off `inputAdapterKind`): `nodeId != null` → resolve via a new Virtual RPC `resolveNodeHit`/`VirtualDomainBus.requestResolveNodeHit(contextId, nodeId)` (mirrors `resolveElementHit`'s addressing/`isDeliverableDestination` guard, but looks up by `domNodes.get(nodeId)` instead of `document.querySelector(selector)` — no new identity-table replica, reuses the one that already exists on Virtual) → dispatch pointer at the live-resolved `x`/`y`; `nodeId == null` (empty-space hit-test miss) → documented fallback: dispatch at the client's raw coordinate, unresolved, no Virtual round trip at all — accepted trade-off, not silently wrong (a miss on `os-abs` would instead fail-closed via census; `sparse-cdp` prioritizes never blocking over never mis-clicking empty space). New lab-only helper `PageProjectionBrowserSession.resolveAndClickDomInputByNodeId(selector, contextId)` (sibling to existing `resolveAndClickDomInput`, addresses by nodeId instead of coordinate) proved the full live wire end-to-end in Docker: root-context click resolved through `resolveNodeHit`→`domNodes.get`→live point→CDP dispatch, asserted via real DOM state read (`#status[data-state]`), not a protocol signal. **Not independently re-proven this pass:** nested-context (`contextId>1`) `resolveNodeHit` — a standalone harness attempt hit an unrelated boot-setup issue (even the already-proven coordinate path didn't land in that harness), while the *official* `input-iframe-click` blueprint (coordinate-based, same `requestResolveElementHit` addressing machinery `requestResolveNodeHit` mirrors) reconfirmed green under `sparse-cdp` with no regression — nested nodeId-click correctness is inferred by shared-code-path symmetry, not independently E2E-proven; do not read this as accept for nested until it is. New interactive-lab affordance: `client.html`'s `inputAdapter` `<select>` + `browse.start`'s `inputAdapter` field (wsSession.ts/protocol.ts/chassis.ts) so the human tester at `http://127.0.0.1:4103/` can pick `sparse-cdp` for live browse testing, not just the CLI blueprint runner — `session.booted` echoes the active adapter back so `main.ts` sets `capturePolicy: 'sparse'` on the client capture only when it matters. Side note, not a fix: because `resolveNodeHit` targets exactly the one context the user's hit-test named (not a `Promise.all` fan-out over every known context like `applyScrollCensus`), `sparse-cdp` clicks are naturally far less exposed to `PP-INPUT-VIRTUAL-MINT-GHOST` (open.md) than `os-abs` — an unrelated dead ad iframe elsewhere on the page can no longer hang an unrelated click — but that bug is **not closed** and still fully live for the sealed `os-abs` default. | [input.md](input.md) §2.1 · §10.6 · `unifiedIntentTypes.ts` · `projectedInputCapture.ts` · `EventApplier.ts` · `bootstrap.ts` (`resolveNodeHit`) · `virtualDomainBus.ts` (`requestResolveNodeHit`) · `PageProjectionBrowserSession.ts` (`resolveClickTarget`, `resolveAndClickDomInputByNodeId`) · `scripts/scratch/diag/diag-nodeid-click.js` |
| 2026-08-27 | **Root cause found: real-site click death is `VirtualDomainBus.isDeliverableDestination` = "ever minted", not "currently live" (Rodrigo reported clicks dead on eneba.com lab, `input_reject apply_scroll_failed:invoke idle timeout`)** — confirmed on default `os-abs`, unrelated to `sparse-cdp`. `rootRuntime.ts` wires `isDeliverableDestination: (id) => this.mintAllocator.hasMinted(id)`; `ContextIdMint.hasMinted` is `id < next`, monotonic, never goes false once an id is minted. A short-lived ad/tracker iframe mints a contextId then is removed from the DOM in <1s (dossier `journal/contexts.json` showed `frameCount:1` entries). If a click's S6 census still names that id (a race on the Projected side, not just a stale flag), `VirtualDomainBus.routeOutbound` finds no live child window for it, but since `isDeliverableDestination` still reports true, it skips the only fail-closed branch (reachable solely for **never**-minted ids) and falls through to a hopeful broadcast nobody answers. `bus.requestApplyScroll` then blocks the full `RESUME_TIMEOUT_MS` (2000ms); `applyScrollCensus`'s `Promise.all` over `census.contexts` won't resolve *any* entry (including the healthy root ctx 1) until every entry settles, and that ties/loses the race against the sidecar's own `LOOPBACK_INVOKE_IDLE_MS` (2000ms), so the sidecar sees an opaque idle-timeout instead of Virtual's real (slower) `{ok:false}` and rejects the whole down/up pair — exactly the console pattern reported. A `ContextRegistry` (`admitHost`/`dropHost`) already exists and is wired on the **Projected** side (`lab/static/client.js`) for its own bookkeeping, but on **Virtual/root** it is only used for `announceRootOnline` — nothing keeps a live-peer set current there. This is the exact gap the CLOSED `PP-INPUT-NESTED-DROP-LOAD` bug's own note flagged as distinct ("Virtual mint-without-dropHost, wire ghosts in census `[1,N]`") — now confirmed live, not theoretical. **Secondary finding, same investigation:** `probes/input-pipeline.json`'s `dropped`/`dropsByError` counters are not wired to `EventApplier`'s reject path (`input_reject` console log) at all — the failing dossier reported `dropped: 0` in the same run that had 6 real console rejections; the probe cannot be trusted alone to prove input health. Filed as **PP-INPUT-VIRTUAL-MINT-GHOST**, open, cutover-blocker — not fixed this pass, needs a real live/attached-peer registry design, not a timeout tweak or a skip-unknown-id band-aid. | [open.md](open.md) PP-INPUT-VIRTUAL-MINT-GHOST · `rootRuntime.ts` · `virtualDomainBus.ts` · `contextRegistry.ts` |
| 2026-08-27 | **First practical input-latency measurement, `os-abs` vs `sparse-cdp` (Rodrigo asked "tá performático?")** — dispatch-command-to-DOM-event wall-clock latency (host `Date.now()` before `resolveAnd*DomInput`, page-side `Date.now()` on the fixture's own `click`/`input`/`change` listener, both same container clock — no `EventApplier.flush()` timing, that resolves before the fire-and-forget peripheral call actually lands). New fixture `perf-input-latency.html` + `scripts/perf-input-latency.js`; had to record timestamps as a DOM attribute, not `window.__hits` — `PageProjectionBrowserSession.evaluate()` runs in a Patchright isolated world, which shares the DOM tree with the page's main world but not its JS global object, so a page-authored `window` property is invisible to it (DOM attributes are shared platform state). N=20, 200ms gap between samples (single-user pacing, not throughput/stress): `os-abs` click avg 7ms / p95 23ms, checkbox avg 4.5ms / p95 8ms; `sparse-cdp` click avg 17ms / p95 26ms, checkbox avg 15.6ms / p95 26ms — `sparse-cdp` is ~2x `os-abs` here but both are far under human-perceptible lag (~100ms). `type` (`resolveAndTypeDomInput`) reads ~90ms flat on **both** adapters — that is the API's own hardcoded 80ms post-focus settle before the first keystroke dominating the sample, not a backend cost; not a valid per-character comparison point. **Still not measured:** throughput under sustained/concurrent load, multi-session behaviour, resource ceiling — this is single-shot human-pace latency only. | `Refactor/sidecar/browser/mirror/projection/lab/fixtures/perf-input-latency.html` · `Refactor/sidecar/scripts/perf-input-latency.js` |
| 2026-08-27 | **`sparse-cdp` distinct-target click race found + fixed under stress (Rodrigo asked "quebra sob carga?")** — ran the full lab blueprint catalog against `sparse-cdp` (not just click/forms/scroll from the same-pass proof below): `input-scroll-components`, `input-iframe-scroll`, `input-iframe-click` passed clean, but `input-e2e-stress` (4 distinct-target clicks fired back-to-back on a 48-panel grid) failed non-deterministically — `clicks=0` then `clicks=1` of 4 expected, reproduced across 3 separate runs, not the known `Target.createTarget` boot flake. Root cause: `SparseCdpPointerPeripheral.button()` read `this.lastX`/`this.lastY` **lazily inside its enqueued CDP-send closure** instead of capturing them at call time. `EventApplier.applyOne` fires `pointer.moveTo`+`pointer.button` for several distinct targets **synchronously back-to-back** (its pointer API is void/fire-and-forget, never awaited between intents) while the actual CDP round trips are still queued behind a promise chain — so by the time an early target's `mousePressed`/`mouseReleased` closure finally ran, `lastX`/`lastY` had already been overwritten by a later target's `moveTo`, and every queued press/release landed at the LAST target's coordinates instead of its own. Not caught by the original unit test because it only ever exercised same-coordinate down+up (a single click), never two different targets fired without an intervening await. Fix: capture `x`/`y` into a local `const` synchronously inside `button()`/`sanitize()` before enqueueing, not read from mutable instance state inside the deferred closure. Added a regression unit test (`testBackToBackClicksAtDistinctTargetsKeepOwnCoords`, deferred fake `send` via `setTimeout` to reproduce the race) plus made `probes/input-pipeline.json`'s `backend`/`path` fields honest (`LabChassis` now tracks the actual `inputAdapterKind` from `boot()` instead of a hardcoded `'os'` literal — a stale label would have silently misrepresented which path a stress run actually exercised). Reverified: full 8-blueprint catalog green under `sparse-cdp` post-fix, including 3 back-to-back clean runs of `input-e2e-stress`; `os-abs` unaffected (no code shared with the fixed file) and unit suite still 100% green. **Still not done:** no latency/throughput percentiles, no sustained-load/multi-session concurrency, no resource ceiling measured — these lab blueprints only assert functional DOM correctness, not performance; `sparse-cdp` is functionally proven for its closed catalog, not perf-validated. | [input.md](input.md) §2.1 · `sparseCdpInputAdapter.ts` · `sparseCdpInputAdapter.unit.ts` · `LabChassis.inputAdapterKind` |
| 2026-08-27 | **`sparse-cdp` wired into `launch()` + lab Docker effect-oracle proof (Rodrigo)** — opt-in via `BrowserLaunchOptions.pageProjectionInputAdapterKind` / lab CLI `--input-adapter sparse-cdp` (never an env var, unchanged from the prior ruling). Boot order: `os-abs` is built *before* `Display.start` (its evdev paths feed Xorg config); `sparse-cdp` is deferred until *after* `launchChrome()` (needs a live CDP session) and dispatches through a new `PageProjectionBrowserSession.currentCdpSession()` indirection, not a captured `this.chrome.cdp` snapshot. Found and fixed two real bugs surfaced only by this wiring (neither caught by the prior unit-only proof): (1) `openSparseCdpInputAdapter` extracted `cdp.send` as a bare function reference, dropping patchright's `CDPSession` `this` binding and failing every dispatch with an opaque `undefined` TypeError; (2) the adapter was bound once at `launch()` time to the pre-`navigate()` page's CDP session, which `navigate()` then closes — every dispatch after the first navigate silently died with `Target page, context or browser has been closed`. Docker rebuild also surfaced an unrelated pre-existing regression from the 2026-08-27 `os/` input-plumbing move: 10 scripts (incl. `lab-input-suite.js`, `smoke-input-os.js`, `spike-abs-pointer.js`) still required the pre-move `dist/browser/patchright/input/{uinput,logical-to-device}` path and were silently fail-closing "uinput unavailable" even with `/dev/uinput` present — fixed to `dist/browser/input/os/*`. Proof: `input-click`/`input-forms`/`input-scroll` blueprints green under `sparse-cdp` via real DOM state assertion (`evaluate` throw-on-mismatch, not telemetry) — click flips `#status`, typed value round-trips through the printable-char `Input.insertText` catalog including non-alnum (`hello-input`), scroll unaffected (already adapter-agnostic). Sealed `os-abs` default reverified 8/8 on the OS input suite after all of the above. | [input.md](input.md) §2.1 · `PageProjectionBrowserSession.currentCdpSession` · `sparseCdpInputAdapter.ts` |
| 2026-08-27 | **Input adapter port category introduced** — "input adapter" (ports + `createInputAdapter`) is a new category, distinct from the already-purged input-v2 Mode A/B/C letters. `os-abs` (`Refactor/sidecar/browser/input/adapters/osAbsInputAdapter.ts`) is the sealed v0 production adapter — 100% behaviourally identical to the pre-extraction inline `AbsOsInputStack` wiring. A second adapter is permitted only when it sits behind the same `EventApplier`, the same wire (`UnifiedIntent`), and the same S6 Phase A census law — and must never reintroduce an env-var toggle (like the purged `SPECULUM_INPUT_BACKEND`) or use CDP as the sidecar↔Virtual data-plane carrier (that stays loopback WS per E-03/E-08). | [input.md](input.md) §2.1 · `Refactor/sidecar/browser/input/ports.ts` · `createInputAdapter.ts` |
| 2026-08-27 | **Projected nested drop cancels pending `load` bind (Rodrigo)** — `dropNestedHost` must `cancelPendingNestedHost` (cancelled flag + `removeEventListener`) and drop `pendingNestedFrames`. Leaving the listener after clearing `nestedHostAwaitingLoad` → late bind → ghost id in `ProjectedInputRuntime.registry` → S6 census includes orphan → Phase A / click dies. Not ad-hoc; completes drop. | [multi-document.md](multi-document.md) §4.1 · [input.md](input.md) §4 · `ProjectionClient.ts` |
| 2026-08-27 | **`sparse-cdp` accepted as a second input adapter (experimental/opt-in)** — CDP-backed, closed catalog (click = single moveTo+press+release, minimal `Enter`/`Escape`/`Tab` keys + printable-char `type` via `Input.insertText`; `scrollSet`/`setFiles` already adapter-agnostic, unchanged). Continuous pointer move/hover/drag are a deliberate, adapter-specific gap — rejected as a no-op, not silently misapplied. Unit-proven only (`sparseCdpInputAdapter.unit.ts`); lab Docker effect-oracle proof is a follow-up, not done this pass. Does **not** reopen input-v2 Mode A/B (different port surface behind `IInputAdapter`, no env-var toggle, does not touch the Virtual↔sidecar data-plane carrier — that stays loopback WS per E-03/E-08). `os-abs` is unchanged and remains the only kind `PageProjectionBrowserSession.launch()` actually constructs today. | [input.md](input.md) §2.1 · §7 · `Refactor/sidecar/browser/input/adapters/sparseCdpInputAdapter.ts` |
| 2026-08-26 | **OS unified input SEALED (Rodrigo)** — [input.md](input.md) lacre after loopback Phase A, LB-03 resolve, S6 ContextBus RPC, Docker spike + suite 8/8 + accept same-origin PASS. False SEAL (CDP MAIN) reverted earlier same day. | [input.md](input.md) §6 |
| 2026-08-26 | **Virtual resolve drain (Rodrigo)** — per-context `frameEmitter.flushNow()` before `keyOfSelector` / `resolveElementHit`; sync identity drain; wire emit only if pending work. | [input.md](input.md) §5 |
| 2026-08-26 | **S6 census Projected — ContextBus RPC** — `ProjectedInputRuntime` in-process fabric; capture invokes `snapshotScrollPositionsFromAllContexts` → RUNTIME fan-out `snapshotScrollPosition` per context (draft §10.1b). **Walk `snapshotAllContextsCensus` reverted** (lab≠prod ad-hoc). | [input-unified-design-draft.md](input-unified-design-draft.md) §10.1b · `projectedInputRuntime.ts` |
| 2026-08-26 | **LB-03 expand lab resolve (Rodrigo)** — loopback `keyOfSelector` + `resolveElementHit` (Virtual ContextBus fan-out). Lab `resolveAndScrollElement` / `resolveAndClick` (incl. nested) use these only — no CDP MAIN. | [input.md](input.md) §5 |
| 2026-08-26 | **Lab input suite harness flake** — `pkill chrome` + retry on `Target.createTarget` between blueprints (Docker infra only; lab=prod path unchanged). | `lab-input-suite.js` |
| 2026-08-26 | **CDP MAIN producer RPC = ad-hoc reverted** — Phase A / callProducer must use loopback `invoke`/`invoke-result` (D-UI-28). Isolate `page.evaluate` is not a reason for CDP and does not offload MAIN. [input.md](input.md) demoted to CUTOVER (not sealed). Expand LB-03 catalog: applyScrollCensus, applyScrollSet, haltWorld, resumeWorld, flushFrame, snapshotContext. | [input.md](input.md) |
| 2026-08-26 | **OS unified input (false SEAL)** — agent claimed SEAL v0 + lab PASS via MAIN-world CDP evaluate + ABS chrome-inset. **SUPERSEDED same day** by loopback-invoke ruling above. Mode A/B stay purged. | [input.md](input.md) + LAB-DOCKER.md |
| 2026-08-25 | **D-UI-20 ABS uinput PASS gate** — openAbsPointer + Docker spike scripts/spike-abs-pointer.js; PP launch Display+ABS fail-closed; no REL fallback. Run: npm run lab:docker:spike. | spike-abs-pointer.md + LAB-DOCKER.md |
| 2026-08-25 | **OS input cutover (PP)** — hot path UnifiedIntent → EventApplier → ABS; Mode A/B CDP removed from PP session; lab input = Docker /dev/uinput. | input-unified-design-draft.md + README Now |
| 2026-08-25 | **Virtual assets V1 path** — D-SPEC-7 rewrite hop (Lab+Live), L1/`getAsset`, paint `appendSessionAuth`, Lab `/w7s/virtual-*` same contract; pass-through + HLS/DASH manifest rewrite; blob/data. MSE/DRM still stubs. | [virtual-assets.md](virtual-assets.md) |
| 2026-08-24 | **Input V2 working, not sealed** — landed A/B/C + touch CDP; fine-tuning backlog (iOS link, IME, polish) before seal. Next focus: virtual assets. | [input-v2.md](input-v2.md) § Working status |
| 2026-08-24 | **Mode A touch CDP** — intent `pointerType: 'touch'` → `Input.dispatchTouchEvent`; mouse otherwise. Fixes sticky `:hover` double-tap when mobile client remoted as mouse. | [input-v2.md](input-v2.md) |
| 2026-08-23 | **ContextBus SEALED** — dumb inter-context JS transport (`emit`/`invoke`, channel, RUNTIME id `0xFFFFFFFF`). Domain protocols sit on top. | [context-bus.md](context-bus.md) |
| 2026-08-23 | **Input A/B/C LOCKED** — A = CDP fire-and-forget (pointer/key/viewport); B = Control→`domNodes` (`scrollElement`/`focus`/`blur`/`input`); C = CDP handle **only** `setFiles`. Id-assertive activate SUPERSEDED. No sidecar table replica for input. | [input-v2.md](input-v2.md) |
| 2026-08-22 | **Input plane = no sync** — no `generation_stale` gate; no CDP/frame generation coupling on intent path. Envelope `generation` journal-only. **Amended 2026-08-23** by A/B/C (activate is coords CDP, not resolve). | [input-v2.md](input-v2.md) |
| 2026-08-22 | **Input capture Document + onArmed re-fire** — listeners on Document (survive in-place `<html>` replace); `onArmed` after every resync iframe swap so lab/Live rebind. Once-only arm = stage navigates to shell origin (lab `not found`). | [input-v2.md](input-v2.md) Client capture |
| 2026-08-21 | **BrowserSession mirror contracts SEALED** — [browser-session.md](browser-session.md): core + PP + video; sinks; permission host; raw `getStateSnapshot`; `requestResync` only; no diagnostics facade; CPU profile on core | browser-session.md + observability.md §5 + open.md CUTOVER-SESSION |
| 2026-08-21 | **Contract cutover impl** — sealed factory Live; `PageProjectionBrowserSession`; delete `LivePageProjection`; wire `RequestResync` / drop GetResync+ReportClientState | CUTOVER-WORKSPACE + sidecar + Api |
| 2026-08-20 | **CSP SEALED** — [csp.md](csp.md) §§3–7 + `session/csp/*`; units/e2e. Next cutover: script inject (same hook). | csp.md + CUTOVER-WORKSPACE |
| 2026-08-20 | **CSP cutover redesign** — surgical Response-stage Document mutate; nonce strip + compensation; amends E-03/E-08 (CSP ok ≠ page WS prod). | [csp.md](csp.md) |
| 2026-08-22 | **Input V2 id-assertive LOCKED** — press/up/focus/input resolve `nodeId` then CDP on that element; coords-only activation = defect. **SUPERSEDED 2026-08-23** by Input A/B/C (activate = Mode A CDP coords). | [input-v2.md](input-v2.md) |
| 2026-08-20 | **Input V2 lab M1 closed** — [input-v2.md](input-v2.md); gate 6 lab blueprints. Touch/OS pointer intents **out of scope** (Projected local/native). MotorAssert on Live = **cutover** (gate 10). **Amended 2026-08-22** by id-assertive dispatch ruling. | roadmap.md + input-v2.md + README Now |
| 2026-08-13 | Table = replicated structure (P0); two-phase apply; preTableHash; 27 opcodes; no MOVE/REPLACE; prevSibling topology; tableHash; STR_DEF deferred; establish **deleted**; id 1 = Document; producer construction §5; P8 no lifecycle branches | frame-protocol.md decision log |
| 2026-08-13 | OPEN-5 closed: `emitResyncFrame` / `resyncVirtual`; double-buffer swap on CHECK | frame-protocol.md §5.8 + log |
| 2026-08-13 | OPEN-6 reframed multi-document / nested documents — pinned for lab | frame-protocol.md §10 |
| 2026-08-14 | Production cutover requires full product (CSSOM + OPEN-6 + input redesign) | roadmap.md + open.md CUTOVER-FULL |
| 2026-08-16 | Canvas **content** projection = **last product feature** before Integration / cutover (interim placeholder until then; not a seal-gap) | roadmap.md gate 6 + support-matrix.md + seal-gaps.md Related |
| 2026-08-14 | V4ProjectionBrowserSession temporary; must be a complete BrowserSession at cutover (not legado, not a lab stub) | roadmap.md + open.md CUTOVER-SESSION — **amended 2026-08-21** by sealed [browser-session.md](browser-session.md) (`PageProjectionBrowserSession`) |
| 2026-08-14 | E-03/E-08: reject blunt CSP/`connect-src *`/PNA punch as antibot-unsafe enablement | open.md E-03/E-08 |
| 2026-08-26 | E-03 revised: loopback WS = sole Virtual↔sidecar carrier; CDP exposeBinding plane purged | open.md · roadmap gate 8 |
| 2026-08-14 | PP-FR-1 prune at drain (`!isConnected`); client REMOVE parent mismatch → desync. Stress-churn stacked digits closed; prepend O2 still open. Narrative: observability.md §8 | observability.md §8 + frame-protocol.md §5.4/§5.6/§6 |
| 2026-08-13 | Micro-opts: Set reuse, `element.attributes`, conditional opCounts | frame-protocol.md log |
| 2026-08-13 | 48 KB first-frame = injected script; `currentScript.remove()` | frame-protocol.md log |
| 2026-08-13 | STR_DEF left open | frame-protocol.md log |
| 2026-08-13 | Real-site CPU probes (wiki, BBC, eneba); CSP loopback block; Akamai IP block | frame-protocol.md log |
| 2026-08-13 | `resolvedBefore` O(N²) → `walkSiblingRun` | frame-protocol.md log |
| 2026-08-13 | Lab benchmark tool (CPU, invariants, structural diff, report export) | frame-protocol.md log |
| 2026-08-14 | NODE_DROP subtree resurrection fix | frame-protocol.md log |
| 2026-08-14 | Same-tick GC vs reattach ordering fix | frame-protocol.md log |
| 2026-08-14 | `NODE_DROP_AGE_SEQUENCES` 120→20 | frame-protocol.md log |
| 2026-08-14 | Stage 4 lab resync + real double buffer; `everArmed`; `emitResyncFrame` only mid-session | frame-protocol.md log |
| 2026-08-14 | OPEN-7 `insertBatch` nextSiblingOf — confirmed, **not fixed** | frame-protocol.md §10 + [open.md](open.md) |
| 2026-08-14 | Spec tree sanitized: live V4 vs `archive/` | this reorganization |
| 2026-08-14 | OPEN-7 **CLOSED** — `insertBatch` reverse link + unit falsifier | frame-protocol.md §10 + [open.md](open.md) |
| 2026-08-14 | O2 local oracle (table × Virtual live DOM) — lab gate 2 | [oracles.md](oracles.md) + `tableLiveOracle.ts` |
| 2026-08-14 | Lab is a BrowserSession **caller**; three telemetry kinds; CPU is a probe; `report.json` is lab-composed | [observability.md](observability.md) |
| 2026-08-14 | Events never assert state; coherent snapshot at sequence S (one JS turn); `tableSize` = `ReplicatedTable.size` | [observability.md](observability.md) |
| 2026-08-14 | OPEN-8 last-child unlink `nextSiblingOf[prev]` — prepend-stress O2 | frame-protocol.md §10 + [open.md](open.md) |
| 2026-08-14 | `MutationObserver.takeRecords` before every drain / snapshot | frame-protocol.md §5.2 + [observability.md](observability.md) §5 |
| 2026-08-15 | Lab CSSOM poll **algorithm** (worst-case-first, idle → next boundary); C5 not relocked | [cssom-poll-algorithm.md](cssom-poll-algorithm.md) |
| 2026-08-15 | CSSOM poll I3: topological copy of rule refs; yield on copy; stale skip; `replaceSync` mass abort (no empty commit); `insertRule` after copy waits next pass | [cssom-poll-algorithm.md](cssom-poll-algorithm.md) |
| 2026-08-15 | CSSOM live eventual; resync always full system + blocking scan; snapshot CSSOM tunable; `rebuildAndResync` = §5.8 `resyncVirtual`; idle starves with the page; no CDP sensor | [cssom-poll-algorithm.md](cssom-poll-algorithm.md) |
| 2026-08-15 | Accept split: DOM numerical 1:1; CSSOM live = perceived 1:1 (not 60 Hz lockstep); amortizations serve practice, not the detector | [acceptance.md](acceptance.md) |
| 2026-08-15 | CSSOM sensor journey: no MO; numbers don’t close; idle+eventual; no hooks/CDP as detector; stress foundation, don’t score it via opts | [cssom-sensor-journey.md](cssom-sensor-journey.md) |
| 2026-08-16 | Lab redesign (design-only): chassis + session identity; browse vs run; run = action graph; tests = blueprints; sharded dossier; no BrowserSession edits | [lab-design.md](lab-design.md) |
| 2026-08-16 | Lab **cutover** (not parallel): single version; L0–L6 sealed; replace-and-delete plan §12 | [lab-design.md](lab-design.md) §12–§13 |
| 2026-08-16 | Lab cutover plan locked: L7–L12 — full DAG, full WS redesign, professional verdicts, §10 layout, smoke rewrite, work only on `feat/mirror-mode` | [lab-design.md](lab-design.md) §8–§13 |
| 2026-08-16 | Lab **cutover complete** on `feat/mirror-mode` — chassis/host, Browse\|Run WS v1, DAG runner, blueprints, sharded dossier; old mains deleted | [lab-design.md](lab-design.md) |
| 2026-08-17 | OPEN-2 **CLOSED** — detached-row GC (end-of-tick detach, `lms`-age drop, no per-row versioning) | [open.md](open.md) + [frame-protocol.md](frame-protocol.md) §10 |
| 2026-08-17 | OPEN-3 **CLOSED** — CHECK over id ranges | [open.md](open.md) + [frame-protocol.md](frame-protocol.md) §4.1 / §10 |
| 2026-08-17 | Inject honesty ATTR/RULESET/EOF — harness, not apply; UI 4077 PASS | [observability.md](observability.md) §7 |
| 2026-08-17 | Lab QA closed; next = SVG ([seal-gaps.md](seal-gaps.md) §2). Id space + OPEN-1 closed same day. | [seal-gaps.md](seal-gaps.md) |
| 2026-08-17 | **SEAL-CSSOM-P1-IDSPACE** — Sheet/Rule ids share `DomNodeTable.mint`; leftover high-bit Cssom range gone | [seal-gaps.md](seal-gaps.md) |
| 2026-08-17 | OPEN-1 **CLOSED** — `NODE_DROP` of an absent id is `malformed` | [frame-protocol.md](frame-protocol.md) §4.2 / §10 |
| 2026-08-17 | **SEAL-DOM-P1-SVG** — `NODE_NEW` Element namespace enum; version 2; `createElementNS` | [frame-protocol.md](frame-protocol.md) §1.3 / §4.2 / §9 + [seal-gaps.md](seal-gaps.md) |
| 2026-08-18 | **PROP_SET form** — producer index + sample every frame; emit VALUE/CHECKED/SELECTED on change; not CSSOM eventual | [frame-protocol.md](frame-protocol.md) §4.4 / §5.9 |
| 2026-08-18 | **PROP_SET dirty = phase 2 only** — table/CHECK always; live field may lag while typing; not a desync | [frame-protocol.md](frame-protocol.md) §5.9 + [input.md](input.md) §7.2 |
| 2026-08-18 | **SEAL-DOM-P1-PROP closed** — `PROP_SET` VALUE/CHECKED/SELECTED on the wire; `iso.formProps` | [seal-gaps.md](seal-gaps.md) + [frame-protocol.md](frame-protocol.md) §5.9 |
| 2026-08-18 | **SEAL-DOM-P1-SHADOW closed** — `SHADOW_ROOT` kind 7; open named; real `attachShadow`; CSSOM poll on admitted roots. Lab `shadow-open`. Closed/manual NIT fail. | [shadow.md](shadow.md) + [seal-gaps.md](seal-gaps.md) |
| 2026-08-18 | **C5 relocked to poll** — write-path hooks rejected as detector (antibot). Paper had lagged the lab. | [cssom.md](cssom.md) C5 + [cssom-poll-algorithm.md](cssom-poll-algorithm.md) |
| 2026-08-18 | **Nested CSS = grouping `cssText`** — top-level rows only. Own-row nested walk = future opt, not a seal hole. | [cssom.md](cssom.md) C3.2 |
| 2026-08-18 | **OPEN-6 designed** — N algorithm instances, one `DataPlane`, `documentId` on envelope, O(1) client slot, `DOC_ATTACH`/`DETACH`. Not pierce. Lab ≠ algorithm. | [multi-document.md](multi-document.md) |
| 2026-08-18 | **OPEN-6 correction** — DataPlane does not track documents. `documentId` on PP header (v3). Document table both sides → host/root node. | [multi-document.md](multi-document.md) |
| 2026-08-18 | **OPEN-6 design structure** — M0–M3/M9 locked (schema, header v3, instance). **M4 binding OPEN** (mint + parent learns child id; no shared heap). | [multi-document.md](multi-document.md) |
| 2026-08-18 | **OPEN-6 restated** — algorithm + ports; self `documentId`; bus `onFrame` mine-or-noop; install inside nested realm; no host index / `DOC_ATTACH`. postMessage is a bus *impl* (M8). | [multi-document.md](multi-document.md) |
| 2026-08-18 | **OPEN-6 instance loop** — produce never apply; pairing D via Id port; desync per instance; halt with realm | [multi-document.md](multi-document.md) |
| 2026-08-18 | **Retract produce-must-not-apply** — Virtual has no apply path; not a bus-echo hazard | [multi-document.md](multi-document.md) |
| 2026-08-18 | **Client identity** — Projected learns D via Id/Install/Bus (scoped channel or injected D). Not a host index in the algorithm. | [multi-document.md](multi-document.md) |
| 2026-08-18 | **Nested documentId = parent mint** — child Id queries; `hostedDocumentId` on host `NODE_NEW`; Projected install already has `mine`. | [multi-document.md](multi-document.md) |
| 2026-08-18 | **Machine** — root id `1`; nested query both sides; session-global mint; nav remints hostedDocumentId; same boot path Virtual/Projected | [multi-document.md](multi-document.md) |
| 2026-08-18 | **Context, not Document** — parent `hosts: Map<nodeId, contextId>` (algorithm memory). No write on the page. Nav / blank `load` = reinstall, same id. Header `contextId`. | [multi-document.md](multi-document.md) |
| 2026-08-18 | **Subtree split** — nested browsing context ≠ shadow ≠ inert template. Declarative shadow is shadow. | [multi-document.md](multi-document.md) |
| 2026-08-18 | **Two kinds of off-`childNodes` subtree** — shadow (same instance) vs nested browsing context (this file). `template.content` is not a third kind. | [multi-document.md](multi-document.md) |
| 2026-08-18 | **Subtree premise LOCKED** — [subtrees.md](subtrees.md). Two features: shadow first ([shadow.md](shadow.md)), nested browsing context second. | [subtrees.md](subtrees.md) |
| 2026-08-18 | **Shadow protocol** — `SHADOW_ROOT` kind 7; real attachShadow; INSERT under root; NODE_META shadow flags dead; open only. | [shadow.md](shadow.md) · [frame-protocol.md](frame-protocol.md) |
| 2026-08-18 | **Shadow closed = NIT** — this version open only; closed/UA unsupported-fail, not CDP. | [shadow.md](shadow.md) |
| 2026-08-18 | **Shadow initFlags** — delegatesFocus / clonable / serializable on `NODE_NEW SHADOW_ROOT`. `slotAssignment: 'manual'` NIT. | [shadow.md](shadow.md) |
| 2026-08-18 | **Shadow in the same frame** — one drain/one table. ShadowRoot is a row, not a light child. Same MO buffer; observe each admitted root. `attachShadow` is not a record: discover `.shadowRoot` when the host is already in the tick. | [shadow.md](shadow.md) |
| 2026-08-19 | **OPEN-6 runtime ≠ algorithm** — runtime once at the root tab (sidecar mux). Algorithm installs in every `window`. Nested has no own WS. Root `contextId=1` without RPC. Nested `getScopeId` to immediate parent (`event.source === iframe.contentWindow`). Timeout-as-root forbidden. RPC = request/response/heartbeat + TCS awaiter. `hosts` not in `CHECK`. | [multi-document.md](multi-document.md) |
| 2026-08-19 | **OPEN-6 header = mine** (`u32`, not GUID). Child-scope indexer per instance. Extra `NODE_NEW` arg only for host nodes (`ns` bit 7 + `childScopeId`; omit otherwise). Mint = root-runtime RPC. Indexer drops with host row. | [multi-document.md](multi-document.md) |
| 2026-08-19 | **OPEN-6 classify / Projected host / bus** — `contentWindow != null`; blank same-origin Projected iframe + parent install; bus all layers, `emitFrame` = root runtime, postMessage. | [multi-document.md](multi-document.md) |
| 2026-08-19 | **OPEN-6 resync request** — **superseded same day** by Control-plane-only entry (`requestResync` → `publishResyncRequest`; loose bus fan-down only). | [multi-document.md](multi-document.md) §4 |
| 2026-08-19 | **Resync single Control-plane entry** — removed upward loose bus + `emitResyncRequest` / `forwardResyncToSidecar` stub; fan-down only after `publishResyncRequest`. |
| 2026-08-19 | **Nested Projected resync parity** — per-context double-buffer + bounded retry ([client/nestedResyncSurface.ts](../../../Refactor/sidecar/browser/mirror/projection/client/nestedResyncSurface.ts)). |
| 2026-08-19 | **Tree snapshot per context** — `__speculumSnapshot` in every bootstrap; bus snapshot RPC `includeTree`. |
| 2026-08-19 | **`parityFingerprint` removed** — not in telemetry v2 schema; iso probes are the assert source. | [observability.md](observability.md) |
| 2026-08-19 | **Multi-context observability** — `TELEMETRY_WIRE_VERSION` 2 + mandatory `contextId`; nested telemetry via bus loose `telemetry` → root fan-out; control RPC **`snapshot`** per instance; lab context index + wire monitor per scope; iso N-way without cross-context sequence sync; CPU Profiler tab-level only. | [observability.md](observability.md) §10; [multi-document.md](multi-document.md) |
| 2026-08-20 | **ISA lacre** — §4 lists only 16 shipped opcodes (`opcodes.ts`). Removed normative text for early-draft ops (`NODE_META`, `DOC_STATE`, `SCROLL_*`, `NODE_SNAPSHOT`, `DOC_ATTACH`, extended `PROP_SET`, `STR_DEF`). Reserved ranges unchanged. | [frame-protocol.md](frame-protocol.md) §3–§4 |

**Stage 4 confirmed (Rodrigo):** mid-session recovery = **`emitResyncFrame` alone** (ids preserved; does not self-heal a corrupt map shape). Client = **real double buffer**, swap only after resync frame CHECK. Lab transport = existing control WS + `PlaneChannel.Control`. Production hub/gRPC is gate 5.

---

## B. Spec-pack D-SPEC-* (2026-08-12) — provenance

Original verbatim table: [`../archive/DECISIONS.md`](../archive/DECISIONS.md). Rows that touch frame/wire/establish/recovery are **historical**.

| Date | Id | Topic | Decision | V4 |
|------|-----|-------|----------|----|
| 2026-08-12 | D-SPEC-0 | Meta | Spec pack created. Existing product code is not a design source. | Pack archived; V4 code is lab engine |
| 2026-08-12 | D-SPEC-1 | `documentState` opcode 12 | Publish title/lang/dir/viewport | **Superseded mechanism** — use table/ops in frame-protocol, not establish ordering |
| 2026-08-12 | D-SPEC-2 | Producer placement | Accumulate/flush/encode **in-page**; API never parses body; no JSON on path | **STILL IN FORCE** (lab Virtual bootstrap) |
| 2026-08-12 | D-SPEC-3 | Pierce | Default identity in-page WeakMap; CDP spike not default | **STILL IN FORCE**; full nested docs = OPEN-6 |
| 2026-08-12 | D-SPEC-4 | establishEnd checksum FNV-1a | | **DEAD** — D-SPEC-13 / §4.7 |
| 2026-08-12 | D-SPEC-5 | Viewport scroll sentinel id 0 | | Keep intent; opcode names follow frame-protocol |
| 2026-08-12 | D-SPEC-6 | In-page script packaging | Single injected bundle | **STILL IN FORCE** (`virtual.js`) |
| 2026-08-12 | D-SPEC-7 | Node rewrite of binary parts | Decode/rewrite URLs/re-encode once | **STILL IN FORCE** for Lab + Live (consumer-agnostic hop; lab no longer skips) |
| 2026-08-12 | D-SPEC-8 | Cssom disjoint id ranges | Dom `[1..0x7FFFFFFF]`, Cssom `[0x80000001..]` | **SUPERSEDED.** V4 is **one id space** (frame-protocol §1.1). |
| 2026-08-12 | D-SPEC-9 | Soft vs hard nav | Soft: no generation bump. Hard: bump + re-establish | **V4:** hard = `EPOCH_RESET` + resync frame, not establish |
| 2026-08-12 | D-SPEC-10 | Resync watermark out of band | | **DEAD** — D-SPEC-14 / in-band `resync` flag |
| 2026-08-12 | D-SPEC-11 | Asset priority module | | Still a production concern; not lab-tree |
| 2026-08-14 | D-SPEC-12 | Meta supersession | frame-protocol.md normative for §1–§6 | **IN FORCE** |
| 2026-08-14 | D-SPEC-13 | Supersedes D-SPEC-4 | CHECK closes resync | **IN FORCE** |
| 2026-08-14 | D-SPEC-14 | Supersedes D-SPEC-10 | Resync is an ordinary in-band frame | **IN FORCE** |

---

## C. Extension E-01…E-11 (2026-08-12) — provenance

Original: [`../archive/engine-redesign-extension.md`](../archive/engine-redesign-extension.md). **E-03/E-08 production: 2026-08-14 reject CSP punch** ([open.md](open.md)). Archive E-08 “strip CSP” is **not** live policy.

| Date | ID | Topic | Decision | V4 / cutover |
|------|----|-------|----------|--------------|
| 2026-08-12 | E-01 | Frame clock | No rAF; `FrameClock` contract; TimerFrameClock | **IN FORCE** (lab `frameClock`) |
| 2026-08-12 | E-02 | Producer threading | Main thread only; defer emit; no historical frame queue | **IN FORCE** |
| 2026-08-12 | E-03 | Data plane loopback WS + channels | `PlaneChannel` Frame/Telemetry/Control | **Canonical sole carrier (lab + Live).** Revised 2026-08-26 (CDP binding purged). |
| 2026-08-12 | E-04 | Op vocabulary | Affirm then-parent §5.4 | **SUPERSEDED** by frame-protocol opcode space |
| 2026-08-12 | E-05 | Identity reverse map | WeakMap + WeakRef + FinalizationRegistry; no DOM identity writes | **IN FORCE** (`DomNodeTable`) |
| 2026-08-12 | E-06 | ISR + double-buffer pointers | MO marks only; swap on clock | Producer: mutation buffer + tick. Client double-buffer is Stage 4 surface, not Frozen pointer |
| 2026-08-12 | E-07 | Isolated World | Producer in isolated world | **IN FORCE** if inject still does this |
| 2026-08-12 | E-08 | CSP / PNA bypass for E-03 | Strip CSP, PNA flags | **SUPERSEDED 2026-08-14** — punch rejected (antibot). Keep site CSP. |
| 2026-08-12 | E-09 | Slice order | Dual track oracles + engine | Lab oracles partial; O1/O4/O5 still open |
| 2026-08-12 | E-10 | No absolute E2E ms as contract | Measure E1/E3/E5 | **IN FORCE** |
| 2026-08-12 | E-11 | `virtual/` module layout | esbuild `virtual.js` | **AMENDED 2026-08-20** — see §J (shared package `core`/`virtual`/`projected`); spirit IN FORCE (one `virtual.js`, Virtual endpoint layout) |

---

## D. Engine-redesign Q1–Q20 (2026-08-11) — provenance

Original: [`../archive/engine-redesign.md`](../archive/engine-redesign.md) §12. Several **SUPERSEDED BY V4**.

| # | Decision | V4 |
|---|----------|----|
| Q1 | Budgets enforced by O3 | Still the target; CI O3 not wired |
| Q2 | Frame is the atom; rate degrade not desync | **IN FORCE** |
| Q3 | Off-DOM uint32 identity; no childAt / F-index / text collapse | **IN FORCE** |
| Q4 | Binary frame; `document` op deleted in favour of establish* | **Half dead:** binary yes; establish deleted too — cold start is resync frame |
| Q5 | Declarative childList + APPEND | **SUPERSEDED** — `INSERT`/`REMOVE` batches, post-order, no APPEND opcode |
| Q6 | Sandboxed same-origin document, double buffered | **IN FORCE** (Stage 4 real second iframe) |
| Q7 | Streamed HTML establish + checksum | **DEAD** |
| Q8 | Local-first interaction; caret client-authoritative | **IN FORCE** for input plane (not lab-complete) |
| Q9 | dialog/popover/media/validity | Still required for 1:1; opcode coverage in frame-protocol |
| Q10 | 60 Hz ladder, hiddenRateHz, watchdog | **IN FORCE** |
| Q11 | Knob defaults; O4 recalibrates | Production |
| Q12 | Pre-warmed pool, destroy-on-release | Production |
| Q13 | K2 + L2 public bytes | Production assets |
| Q14 | Zoom/DPR lockstep; no independent projected zoom | **IN FORCE** |
| Q15 | Rewrite producer/applier; 600 LOC ceiling | Lab modules exist; ceiling is guidance |
| Q16 | Support matrix published | [support-matrix.md](support-matrix.md) |
| Q17 | Supersession banners on pipeline/coalesce | Those files archived |
| Q18 | Intents by uint32 reverse map | **IN FORCE** |
| Q19 | One opcode space, no wire `plane` field | **IN FORCE** |
| Q20 | O2 full only in CI/debug | **IN FORCE** |

Dated log 2026-08-11 (meta revs 1–4, K2/Q13): see archive engine-redesign “Decision log (append-only)”.

---

## E. Handoff process rules (2026-08-13) — still useful

From [`../archive/HANDOFF.md`](../archive/HANDOFF.md) (narrative of the V4 debate — **not a spec**):

- Rodrigo decides architecture.
- No ad-hoc; pay complexity where it is real.
- No files named Live/V2/New/Alt — fix in place.
- Conversation pt-BR; `docs/` English.
- Exit criterion is a passing test, not a status table.

Do not follow HANDOFF “no code yet” — that phase ended when lab Stages 1–4 shipped.

## F. Doc reconciliation (2026-08-14)

Docs are the V4 source of truth; code reflects them. Stale text fixed, **no behaviour change**:

- **input.md addressing** aligned with the sealed model: intents address the target by its `uint32`
  node id via the identity map / client registry — **not** `speculum-anchor` (no DOM attribute, PP-ID-1).
  I5 (LOCKED), §6.7, §17, §19, §20 and the DTO field (`anchor` → `nodeId`) updated. Not a new decision —
  it aligns input.md with frame-protocol §5.7 and the V4 banner it already carried.
- **input.md recovery/armed vocab** (§9.1, §14): `document` opcode + watermark → §5.8 `resync`-flagged
  frame + closing `CHECK`.
- **input.md §7 bindings** annotated: upstream control state is §4.4 `PROP_SET` (property), not a
  `speculum-input-*` attribute; binding rules unchanged.
- **Broken links** repaired: input.md / virtual-assets.md pointed at archived `diff-pipeline.md` /
  `coalesce.md`; now point at frame-protocol.md (live) with the archived pre-V4 doc noted.
- **Still pending:** cssom.md "establish/install" vocabulary (separate careful pass).

---

## G. Lab / observability (2026-08-14)

Full text: [observability.md](observability.md). Sealed with Rodrigo:

- One Chromium path (`BrowserSession`). Lab does not launch Chromium or `page.evaluate`.
- Telemetry = **events** (push, time-series) + **embedded** + **probes** (caller fetch). CPU = CDP probe.
- **Events are not asserts.** Table×table, table×DOM, tree×tree at frame S = **state snapshot** dump + lab oracles ([observability.md](observability.md) §5–§6; [browser-session.md](browser-session.md)).
- Halt/emit/capture in **one** in-page turn; split evaluates are torn reads.
- Snapshot is **raw state planes** at S (digest + opted faces); oracles are caller-side — not session DTO fields.
- `frameEmitted.tableSize` = protocol table size; `identitySize` = WeakRef map (diagnostic only).
- `FrameInvariantMonitor` = wire bytes only. `report.json` = lab dossier, not a session RPC.

## H. CSSOM RULE_SET vs grouping replace (2026-08-16)

Rodrigo: `RULE_SET` is in-place patch for **`CSSStyleRule` only**. Where patch cannot work
(grouping / `@media` etc.), the **producer** emits `RULE_DROP` + `RULE_NEW` (new id). The
client does **not** hide replace inside `RULE_SET`. A `RULE_SET` on a non-style rule is a
producer bug and desyncs.

Seal-gap close requires the matching proof class: function unit ≠ table/live parity ≠
desync-when-needed. Helper-only units do not close ATTR / EOF / RULESET.

## I. Open named shadow shipped (2026-08-18)

Kind `7` on version 2. Root row is not a light child. Per-root MutationObserver, same buffer.
Projected `attachShadow({ mode: 'open' })`. CSSOM poll includes each admitted root (`pierceHost`).
Closed and `slotAssignment: 'manual'` stay explicit unsupported fails. Not iframe.

## J. Shared TS package `@speculum/page-projection` (2026-08-20) — AMENDS E-11

**Status:** DECIDED (Rodrigo). Gate **6.5** packaging hygiene — **not** canvas (gate 7), **not** Production Integration (gate 10).

| Topic | Decision |
|-------|----------|
| Package | `@speculum/page-projection` at `Refactor/packages/page-projection` (`private`; sidecar `file:` link; no root workspaces required) |
| Folders | `src/core/` · `src/virtual/` · `src/projected/` — **no** package root barrel that re-exports all three |
| E-11 map | `models/` → `core/` (wire + shared helpers); `virtual/` → `virtual/` (same endpoint spirit); `client/` → `projected/` (two-phase apply) |
| `core` semantics | Wire/ISA + pure table helpers + `plane/` constants + `intentTypes` + `domTreeSnapshot` — **not** session/host/CDP/lab |
| Out of package | `lab/` · `session/` · `inject/` · CDP `pageProjectionInputDispatch`/`resolveVirtualNode` · gRPC · React UI · oracles package |
| D-SPEC-6 | Still **one** IIFE `virtual.js` from `virtual/bootstrap.ts` (path moves with package) |
| Client API | `ProjectionClient` + `createProjectionClient(deps)` — DI callbacks; no WS/hub inside. Lab-only APIs live in sidecar `LabProjectedHarness` |
| Dependency direction | `virtual`→`core`, `projected`→`core` only; package never imports `lab/`; after extract, `session` must not import `lab/` (probes via DI) |
| Web | Consumes `/projected` + `/core` at **gate 10** only; until then legacy `web/live/page` stays anti-source |
| Timing | Complete extract **before** canvas work; canvas ships into this package. Extract ≠ cutover |

## K. BrowserSession mirror contracts (2026-08-21) — SEALED

**Status:** SEALED (Rodrigo). Normative: [browser-session.md](browser-session.md).

| Topic | Decision |
|-------|----------|
| Shape | `IBrowserSession` (shared) + `IPageProjectionBrowserSession` + `IVideoStreamingBrowserSession` — no covariance / no Launch `oneof` |
| PP class | `PageProjectionBrowserSession` (replaces lab `V4ProjectionBrowserSession` at cutover) |
| Streams | Factory binds session↔mode sink; PP = `onFrame(PageProjectionFrame)` + `onProjectionTelemetry` only |
| Permission | `IBrowserPermissionHost.requestPermission(kind)` — RPC, not sink |
| Resync | `requestResync({ contextId?, reason? })` → frame on stream; drop getResync / sendControl / reportClientState |
| Lab probes | On same PP interface: `haltClocks` / `resumeClocks` / `emitFrame` / `getStateSnapshot` — no diagnostics facade |
| State snapshot | Raw planes + opts; oracles / cascade fixture = caller; CPU profile on **core** |
| Observability | [observability.md](observability.md) §5–§6 updated to match |

**Impl cutover (2026-08-21):** sidecar `createSealedBrowserSessionFactory` selects PP vs `VideoStreamingBrowserSession` at Launch `mirrorMode`; `LivePageProjection` deleted (stub throw); proto drops `GetPageProjectionResync` / `ReportPageProjectionClientState`, adds `RequestResync` + lab clock/snapshot RPCs. Product leftovers (canvas, antibot, asset store) tracked in [CUTOVER-WORKSPACE.md](../CUTOVER-WORKSPACE.md) — do not block contract shape.

| 2026-08-23 | **D-UI-27 ContextBus cutover** — `projectionBus.ts` deleted; `ContextBus` + `VirtualDomainBus` + loopback mux wire (§10.1c). |

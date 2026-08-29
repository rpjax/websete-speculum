# PageProjection — runtime carrier & identity redesign

**Status:** **decisions SEALED 2026-08-29 (Rodrigo)** — cutover in tree (extension C2 + MessagePort + `initContext`; EPOCH_RESET removed). Stealth (V3) still measure before accept.
**Supersedes:** the `PP inject boot SEALED (Rodrigo)` entry of 2026-08-28 in [decision-log.md](decision-log.md),
and the Runtime inject / boot contract at the top of [browser-session.md](browser-session.md) (lines 20–41).  
**Supersedes draft:** `inject-extension-draft.md` (deleted 2026-08-29 — content lived here).  
**Law:** code must mirror this file. Items still marked OPEN are measurement/verify — do not invent around them; stop and ask if blocked.

**How to read the markers**

| Marker | Meaning |
|--------|---------|
| **DECIDED** | Rodrigo ruled. Do not relitigate. |
| **PROPOSED** | Raised, not ruled — should be empty after 2026-08-29 seal package. |
| **OPEN** | Unverified claim / measurement still required before or during impl. |
| **CONFLICT** | Resolved for V1 — see §0. Historical text may remain for provenance. |

---

## 0. Seal package (2026-08-29) — **DECIDED**

Closed with Rodrigo after the Opus handoff. Full rationale remains in §§1–14; this table is the implementer contract.

| # | Decision |
|---|----------|
| 1 | **ContextBus transport:** `MessagePort`. No broadcast. First contact: `window.postMessage` (or root↔SW bridge); reply **transfers** a `MessagePort`; all further parent↔child traffic on the port. Inner nav: parent **closes** the old port (dead-install fence). |
| 2 | **One extension** (webgl + plane + PP runtime). Order = manifest `js: [...]`. One file throwing does not stop later files (Chrome behavior; design relies on it). |
| 3 | **Config C2 (fail-closed):** extension **template** is static on disk; each session **copies** it to a temp dir, writes `c2-endpoint.json` there, and `Extensions.loadUnpacked` **that copy once** at Chrome launch (isolates C2 — never share the template endpoint). Sidecar pushes `SessionConfig` to the SW and **must not navigate** until ACK. Document boot: request config → freeze → `initContext`. Missing config within **`T_config = 2000 ms`** → root **session crash** / nested **dormant**. Bad token → drop. Config immutable after freeze. SW restart: restore from `chrome.storage.session` or sidecar re-push. Amends E-11 §7: explicit config gate, never half-boot. |
| 4 | **Mint: exactly 1 id per RPC** (protocol). **No block allocation** (rejected as ad-hoc). If a nested-host mint is pending, the algorithm **does not emit a frame that tick** until it can emit with a real id. |
| 5 | Nested `initContext` / upward peer timeout → **dormant** at **2000 ms**. |
| 6 | Root upward peer (SW) timeout → **session crash** at **5000 ms**. |
| 7 | **One tab per session** (1 session = 1 Chrome = 1 tab). Enforced by sidecar single-tab + MAIN `single-tab.js`. **No `managedTabId` protocol** — rejected as overengineering. |
| 8 | **Vocabulary:** acquiring `{ contextId, generation }` is **`initContext`**, not “handshake” (handshake reserved for loopback WS / LB hello and for the brief ContextBus port-setup `postMessage`). bfcache: on `pageshow` (persisted) → re-run bus port setup if needed + **`initContext`** again (new `generation`, new port) before emit. |
| 9 | Sandbox opaque: **only** the extension delivers runtime. If Chrome does not run the content script → dormant. NIT until measured (M2). No second injector. |
| 10 | **Stealth (V3):** spike before carrier cutover. If critical antibot breaks → **stop and report**. No silent CDP inject fallback. |
| 11 | **Thin bootstrap split:** out of V1. Measure M4 later; do not build now. |

**Boot sketch (normative):**

```
Chrome launch → loadUnpacked(static extension once)
sidecar ↔ SW: SessionConfig + ACK  → then navigate

every document (document_start, MAIN):
  await config (T_config) → freeze
  install MO + bus listeners
  await initContext() → { contextId, generation }   // nested: parent; root: SW
  activate()  // only now emit
```

**ContextBus port setup (normative):** one public `postMessage` to open the channel; then MessagePort only. That setup step may be called “bus port handshake” in code comments; it is **not** `initContext` and **not** loopback hello.

---

## 1. What started this

Three defects from `lab-runs/2026-08-28T21-04-18-139Z-*`:

1. **Session fault / Virtual crashed.** `cdpSession.send: Target page, context or browser has been closed`
   at `ProjectionRuntimeInstaller.registerOnCdpSession` → `onFrameSession` → `frameCdpSession.attach`.
2. **`point_outside_node`** on Eneba and the ngrok fixture.
3. **"Visit Site" (ngrok): the head moves, Projected stays.** 1 apply in 23 s, `steadyFrameCount: 0`, FPS 0.

Triage separated them into three unrelated problems. Only (1) and (3) belong to this document.
**(2) is layout isomorphism** (UA / font / CSSOM) between Virtual and Projected — a different problem,
tracked separately. Do not fold it in.

---

## 2. Root cause (design level, not defect level)

The runtime injection design rests on five assumptions. All five are false. Verified against code:

**A1 — "there is a moment when we can register the script before the document's first script."**
True for the page target (registered on `about:blank` before `goto`). **False for OOPIFs**:
`frameattached` → `newCDPSession` → `send` are three CDP round trips that start *after* Chromium has begun
committing the iframe's document. `lateBoot` exists precisely because this is false — the safety net is the
confession of the hole.

**A2 — "a target that appeared still exists."**
`attachFrameCdp` guards `newCDPSession` with try/catch, but `registerOnCdpSession`
(`projectionRuntimeInstaller.ts:127`) does `await session.send(...)` with **no catch**, and the handler is
`void attach(frame)` — `void` does not swallow a rejection. An ad iframe that lives 30 ms produces an
`unhandledRejection` which the lab hook turns into a session crash. The initial round
(`await Promise.all(page.frames().map(attach))`) has the same hole and fails *launch*.

**A3 — "document replacement goes through the `navigate()` API."**
False by construction: link click, form POST, `location.assign`, interstitial → site. On that path
`generation` is not bumped, the new heap arms with the same generation, `bootstrap.ts:554`
(`if (config.generation > 1)`) does not fire, no `EPOCH_RESET` is emitted, and nobody awaits
`waitEstablished`. Projected keeps the previous document's table while receiving frames from a new
document with `sequence` restarted. **This is defect (3), and it is a K4 violation on an unmodelled path.**

**A4 — "`lateBoot` is fail-safe."**
It is fail-*closed*, which is different: `probe === null` (target dying, world without scripts, churn) →
no inject, and the only safety net goes silent. It coalesces per `Frame`, so a new document born in the
same `Frame` during an in-flight call inherits the previous document's decision. "Present" includes the
arm alone, so a heap that armed and then threw inside `virtual.js` counts as present forever.

**A5 — "the bundle cache is valid."**
`cachedBundle` is `string | null` with no key, and `buildFrameBundle(_frameUrl)` ignores its parameter
(`BuildProjectionInjectBundleOptions.frameUrl` exists but is dead). It does not bite today only because
`navigate()` recreates the whole installer — which is A3 again.

### The pattern

The design **binds document identity to the sidecar's navigation API, and runtime delivery to CDP's target
bookkeeping.** Both bindings are loose. `lateBoot` is the tape over the gap.

### Stated as a bug-surface count

The code has to *guess* three things it cannot know:

| Guess | How it guesses today | Fix |
|---|---|---|
| "did the runtime boot?" | probe + settle + coalesce + fail-closed | the browser guarantees it — the question disappears |
| "is this document new?" | counter baked into the injected config by the sidecar | the install receives its identity **at birth** |
| "is the parent ready?" | 16 ms spin-wait with a sentinel | one RPC that either answers or does not |

Everything below follows from turning those three guesses into facts.

### The only state keyed to a document today

| State | Keyed by | Outlives a document? |
|---|---|---|
| `registeredSessions: WeakSet<CDPSession>` | target | yes |
| `lateBootInflight: WeakMap<Frame, …>` | frame | yes |
| `lateBootAttempts: WeakMap<Frame, Set<"gen\|url">>` | frame + (gen,url) proxy | yes |
| `generation` | a `navigate()` call | orthogonal |
| `__SPECULUM_PP_INJECT_ARMED__` | heap | **no — correct** |

Only the last one is keyed to the unit of the problem. Concrete consequence of the `"gen|url"` proxy:
reloading the same URL in the same frame at the same generation yields the same key → `already_attempted`
→ lateBoot refuses to act on a document it has never seen.

### Identity that already exists and is unused

CDP already provides the correct key and the projection path consumes neither:

- **`Page.frameNavigated` → `frame.loaderId`** — changes on every document commit and only on a commit
  (same-document navigation arrives as `Page.navigatedWithinDocument`). `loaderId` **is** document identity.
- **`Runtime.executionContextCreated` → `context.uniqueId` + `auxData.frameId`** — one per world per
  document; the event that actually means "a new heap exists in frame X".

The repo's only `Page.frameNavigated` consumer is `patchright/Navigation.ts:314`, outside projection.

---

## 3. Carrier: CDP → extension content script — **DECIDED**

**Decision:** the PP runtime is delivered by an **MV3 content script**, not by
`Page.addScriptToEvaluateOnNewDocument`.

```json
{
  "matches": ["<all_urls>"],
  "js": ["..."],
  "run_at": "document_start",
  "all_frames": true,
  "match_origin_as_fallback": true,
  "world": "MAIN"
}
```

**Why it is structurally different.** The registration lives in the browser process. Chromium injects at
document creation, in every frame, in every process, before any site script — with **no round trip**.
OOPIF and cross-process navigation stop being special cases; they become the normal case.

**Prior art in this repo:** `sidecar/extensions/webgl-spoof/manifest.json` already ships
`world: MAIN` + `all_frames: true` + `run_at: document_start`. This is not a new capability for the stack.

**`world: MAIN` is required, not optional.** The bundle prelude patches `Element.prototype.setAttribute`,
`Node.prototype.appendChild`, `insertBefore`, `replaceChild` (`injectScriptBodies.ts`,
`META_CSP_NEUTRALIZE_BODY`) in the page's own realm. An isolated world would not see those prototypes.
(This is also why decision **E-07** — "producer runs in an Isolated World" — stays superseded, as recorded
in [decision-log.md](decision-log.md) line 188.)

**`match_origin_as_fallback: true` is required.** Chrome 119+, successor to `match_about_blank`; covers
`about:`, `data:`, `blob:`, `filesystem:` by matching against the **origin inherited from the parent**, so
`<all_urls>` matches. Requires a match pattern without a specific path — `<all_urls>` qualifies. This is
how content-bearing `about:blank` / `srcdoc` iframes (GPT / SafeFrame ad tech creates them constantly) get
a runtime.

### Coverage matrix

| Case | `onNewDocument` (page target) | `onNewDocument` (per-OOPIF target) | content script |
|---|---|---|---|
| main frame, first document | yes | — | yes |
| main frame, same-process nav | yes | — | yes |
| main frame, cross-process nav | yes | — | yes |
| same-process iframe | yes | — | yes |
| **new OOPIF** | no | **race (steps 4–6 below)** | yes |
| OOPIF re-navigating | no | yes | yes |
| `about:blank` / `srcdoc` | yes | — | yes *(needs the flag)* |
| `window.open` / `_blank` | no (new target) | — | yes |
| `sandbox` without `allow-scripts` | nothing runs | nothing runs | nothing runs |

The OOPIF race, precisely:

```
1. site creates <iframe src="https://ads.example">
2. frame attaches ─────────► Playwright 'frameattached'  (doc = about:blank, parent's process)
3. navigation begins
4. process swap: NEW TARGET is created
5. renderer commits the document
6. SITE SCRIPTS RUN                     ← the window is 4→6
7. Playwright 'framenavigated'
```

Today's code enters at step 2 and needs two CDP round trips; the target only exists at step 4.

**Rejected alternative — `Target.setAutoAttach({ waitForDebuggerOnStart: true })`.** It does close the race
(the target is created paused; release with `Runtime.runIfWaitingForDebugger`), and there is working prior
art at `sidecar/browser/patchright/worker-target-stealth.ts` (uses `flatten: false` +
`Target.sendMessageToTarget`). Rejected because: Patchright already calls `setAutoAttach` internally and
overriding it fights its frame machinery; every ad OOPIF pays a blocking pause; and it keeps per-target
bookkeeping and every "target died mid-setup" path alive. It hardens the race instead of removing it.

### Consequences of the carrier decision

- **The carrier governs the Virtual side only.** The Projected side runs in the end user's browser (or the
  lab harness), where no extension exists. There, the parent installs the nested algorithm into its blank
  same-origin iframe — [multi-document.md](multi-document.md) §4.1, `ProjectionClient.ts:136-173`. That was
  always true and does not change.
- **The extension reaches more frames than CDP did.** See §11 (measurement M4).

---

## 4. Extension packaging — **DECIDED: one static extension + C2 config**

**DECIDED:** collapse `webgl-spoof`, `speculum-plane` and the PP runtime into **one extension**.
Order = manifest `js: [...]` (preserves today’s explicit bundle order).

**DECIDED: C2** — static **template** on disk; each session materializes a **per-session copy**,
writes `c2-endpoint.json` into that copy, `loadUnpacked` once per Chrome launch on the copy;
`SessionConfig` still arrives by sidecar → SW (ACK before navigate, §0 #3).  
**C1 (per-session `config.js` baked into the copy) rejected** for V1 — config stays on the C2
socket, not a second file format. Per-session **directory** copy is required so concurrent
sessions do not share `c2-endpoint.json` (K2).

`buildConfigPayload()` survives as the **SessionConfig** shape / validation.  
`buildConfigPreScript()` (string serializer into CDP inject) dies with the installer.

E-11 §7 amended: config is still read once and frozen, but only **after** the async config gate
succeeds — never activate without a complete bag.

---

## 5. Runtime architecture — **DECIDED (shape)**

```
sidecar boots the browser with the extension
  └ background service worker runs for the whole session; opens the loopback WS;
    handshakes with BrowserSession over the existing loopback protocol
the extension guarantees PP runtime installation in every JS context

every PP runtime implements one fixed `Runtime` interface
  — no branching, single path, dependency inversion
  — `Runtime` uses `ContextBus` internally
```

**The load-bearing idea: the socket moves out of the root document and into the service worker.**
Today `RootRuntime` lives in the root document and owns the sidecar connection, so root navigation kills
the socket and forces the whole `waitEstablished` / generation dance. With the SW owning it, the socket
**survives root navigation** and the root document stops being special *for transport*. This is what makes
"one interface, no branching" true rather than aspirational.

### `init()` — **DECIDED, with the ordering correction**

```ts
init() {
  installMutationObserver();   // BEFORE the await: at document_start the parser is
                               // filling the tree during initContext
  installBusListeners();       // BEFORE the await: a CHILD of this context can ask
                               // before this context finishes its own initContext
  const { contextId, generation } = await initContext();
  activate();                  // only now does it emit
}
```

**Vocabulary:** `initContext` acquires `{ contextId, generation }`. Do **not** call this “handshake”
(reserved for loopback LB hello and for ContextBus **port setup** — §0 / §8).

Two rules that are not negotiable:

1. **Observer before await.** Observing after `initContext` loses everything the parser inserted during it,
   and reintroduces the snapshot-to-recover path the guaranteed carrier just removed.
2. **Listeners before await, with queuing.** With the extension every context boots in parallel at
   `document_start`, so "grandchild asks before I have my id" goes from rare to common. The listener goes
   up early and **queues** requests until it can answer. Queuing is cheap; a lost request is a permanently
   dormant context.

### Root-ness is bus wiring, not a conditional — **DECIDED**

```
root context     → the bus's upward peer is the SERVICE WORKER
nested context   → the bus's upward peer is window.parent
```

Same `initContext()`, same `init()`, zero `if (isRootContext)`. The difference is injected, which is what
"single path with dependency inversion" means.

### Terminal policy — **DECIDED**

| Context | No answer after T | Terminal state |
|---|---|---|
| root | SW did not answer (`T = 5000 ms`) | **crash** — the session is broken |
| nested | parent did not answer (`T = 2000 ms`) | **dormant** — does not emit, does not error, does not loop |

`initContext` is the **activation gate**, not a health precondition. The extension delivers into frames that
will never be admitted (ad iframes, frames that die in 30 ms, hosts that never become connected). Those
legitimately never get an answer. Treating that as a crash would crash on every ad iframe.

Config gate is separate: **`T_config = 2000 ms`** before `initContext` (§0 #3).

### Service worker lifetime — **DECIDED: 5 s heartbeat**

MV3 service workers are terminated on idle (~30 s). WebSocket traffic resets the idle timer in current
Chrome, so a **5 s heartbeat, reset by activity**, keeps it alive.

**Still required regardless:** no critical state may live only in SW memory. Design for "the SW can restart
mid-session" — persist to `chrome.storage.session` or make it re-derivable. If the SW holds the contextId
allocator or any session state, a restart loses it.

---

## 6. Identity — `contextId` and `generation`

### `contextId` — **DECIDED: unchanged semantics**

`contextId` remains **per browsing context**, minted by the parent, announced on the host row's `NODE_NEW`,
answered to the child via `getScopeId`. [multi-document.md](multi-document.md) §2–§7 is **intact**.
Inner navigation keeps the same `contextId` (§5, "nav / blank `load`: same `contextId`; reinstall; no
remint").

**Why the parent hop is irreducible.** With the extension, every context can reach the SW directly through
its ISOLATED content script, so skipping the parent looks tempting. It does not work: the SW has no view of
the DOM and cannot answer "who am I?" for a nested context. Only the parent, which observes the iframe
element, holds the mapping.

`contextId` is not identity in the ordinary sense — it is a **rendezvous name between two installs that
never talk to each other**: the Virtual child (in Chromium) and the Projected child (in the end user's
browser) boot independently. If each generated its own, they would never match. The name must be born
somewhere that can announce it to both sides, and that place is the Virtual parent, whose channel to the
Projected parent is the host row.

That is also why a child can never invent an id, and why a timeout must never become an id.

**The parent can always identify which host is asking.** `event.source` → `childScopes.lookupByContentWindow()`
already implements this, including the linear-scan fallback that rebinds the WeakMap after `contentWindow`
is replaced by inner navigation. `iframe.contentWindow` (the WindowProxy) keeps object identity across
navigations, which is exactly why "same contextId across inner nav" works.

**Traceability is kept — DECIDED.** Sequential ids from a central allocator, for observability. Rodrigo
ruled that the per-call JS RPC cost is acceptable; that stands. **One mint per RPC** is protocol (§0 #4).

### Mint granularity — **DECIDED: 1 id per RPC; no frame emit while pending**

The historical `createMintPort` (`childScopes.ts:120`) returns `null` while a single RPC is in flight and
suppresses concurrent requests. That made depth ≥ 2 look like a K4 hole when hosts were **omitted from an
emitted frame**.

**DECIDED (Rodrigo):** keep **exactly one mint id per RPC**. Do **not** batch/block-allocate (rejected as
ad-hoc). If a nested-host mint is pending, the algorithm **does not emit a frame on that tick** until it
has conditions to emit (real id). Waiting is the protocol; inventing 64-id blocks is not.

**Why depth ≥ 2 still matters:** the root uses sync `mintFn = () => runtime.mint()` today; only nested
instances hit the async port. Fixing boot will exercise this path — V1/V2 in §11 remain verify items, not
an excuse to change the mint cardinality.

### `generation` — **DECIDED: kept as a wire field, acquired at `initContext`**

```
initContext() → { contextId, generation }

contextId  = address. Stable while the browsing context exists. Who listens to what.
generation = which install. New on every boot at that address.
```

**What changes:** `generation` stops being a counter allocated by the sidecar and baked into the injected
config. That allocation is precisely why in-page navigation produces no epoch: `bootstrap.ts:554` only
emits on `config.generation > 1`, and a link click never bumps it. Acquired at `initContext`, **every document
replacement produces a new generation, from any cause** — click, form, redirect, interstitial, `navigate()`.
No cause enumeration, no detection.

Useful reframing: `generation` is best understood as **"which install"**, not "which navigation". What dies
and is reborn is the install; navigation is only one of the causes.

**Root asymmetry — note it in the design.** `contextId` for the root is a constant (`1`, no RPC).
`generation` for the root has no parent, so it comes from the **SW** via `initContext`. Two sources, not one.
The root therefore installs the observer, buffers, and stamps once the generation arrives — it can no
longer read it synchronously from config.

**`waitEstablished` changes shape.** It stops waiting for a number the sidecar *predicted* and waits for
the next hello carrying a generation different from the previous one. The sidecar stops predicting and
starts observing — it stops asserting things about the browser it cannot know.

**Verified property: nothing in the system ever compares `generation` by order.** Every comparison is
`===` / `!==`:
`ProjectionClient.ts:382` · `nestedProjectedApply.ts:233` · `nodeDataPlane.ts:336` (`generation_mismatch`) ·
`nodeDataPlane.ts:121` · `nodeDataPlane.ts:376` · `frameInvariantMonitor` rule `generation_stable`.
The only ordering comparison in the repo is `bootstrap.ts:554` `if (config.generation > 1)`, which is an
"am I the first?" sentinel, not ordering — and it dies with `initContext`.

**Risk posture — deliberate.** Keeping `generation` means the "channel fence" (§8) stops being structural
load and becomes an optimization: a stale frame is dropped silently by the field instead of surfacing as a
spurious desync. Belt and suspenders, chosen on purpose.

### `contextId` per install — **REJECTED**

Considered and dropped. It would subsume `generation`, but emitting the change costs a new opcode
("update context id") plus a new dirty category in the parent, and makes the parent responsible for
notifying an event it learns about asynchronously (its MutationObserver is silent on inner navigation —
[multi-document.md](multi-document.md) §5).

The benefit that motivated it — **teardown by object lifetime instead of a seven-item cleanup list** — does
**not** require changing the address. It requires the Projected side to be *told* to rebuild the instance.
See §7.

If it is ever revisited: do **not** build a parallel opcode accumulator. Mark the host node dirty in a new
category (`scopeDirty: Set<Node>`) beside the existing `attrDirty` / `textDirty` and let the existing flush
emit. A Set, not a second pipeline with its own flush protocol and ordering rule.

---

## 7. Protocol: `EPOCH_RESET` dies — **DECIDED**

**Decision:** "epoch" leaves the protocol vocabulary. One name for one thing: `generation`.

### Removed

- opcode `EPOCH_RESET` (`0x02`) and everything named after it: `OpCode.EpochReset`, `EpochResetOp`,
  `applyEpochReset`, the case at `replicatedTableApply.ts:39`, `binaryFrameEncoder.writeEpochReset`,
  `decode.ts:271-272`, the `epochReset` entry in the opcode name map. Opcode `0x02` becomes free/reserved.
- **ordering rule §7 rule 1** ("`EPOCH_RESET` first, if present").
- **the redundant double check.** Today (`ProjectionClient.ts:382-390`, `nestedProjectedApply.ts:233-238`):

  ```js
  if (frame.generation !== this.generation) {
    const firstOp = frame.ops[0];
    const isEpochReset = firstOp?.op === OpCode.EpochReset;
    if (!isEpochReset || firstOp.generation !== frame.generation) { desync }
    ...
  }
  ```

  The header already states the generation; the first op had to state it again. Redundant by construction.
  It becomes:

  ```js
  if (frame.generation !== this.generation) → destroy the applier instance, recreate, apply
  ```

- `frameInvariantMonitor` rule `generation_stable` → becomes **"generation only changes on a frame with the
  `resync` flag"**.
- `config.generation`, `if (config.generation > 1)`, and `waitEstablished({ generation })` in its current
  form.

### Teardown becomes object lifetime — **DECIDED**

`applyEpochReset` currently enumerates what to clear:

```js
for (const childScopeId of this.childScopes.values()) this.options.onNestedHostDrop?.(childScopeId);
this.childScopes.clear();
this.nestedHostIds.clear();
this.doc.replaceChildren();
ensureStandardsBlankDocument(this.doc);
this.registry.clear();
this.propDirty.reset();
this.clearCssom();               // sheets, rules, sheetHost, paritySheet, adoptedStyleSheets
```

None of that is the node table. It is **everything the `tableHash` does not cover**. Destroying the applier
instance and building a new one discards all of it by construction. A list forgets an item; a destructor
does not.

**`preTableHash` does not do this job — do not conflate them.** `preTableHash` is a per-frame precondition
*within* one install (`applyDom.ts:174`: `if (!frame.resync && frame.preTableHash !== this.table.tableHash)`).
What kills an epoch is the identity change. Someone will eventually try to delete `preTableHash` on the
theory that epoch covers it; it does not, and the reverse is also false.

### The doctype gets a better home — **DECIDED**

`ensureStandardsBlankDocument` lived inside `applyEpochReset`. With teardown by instance it moves to the
**applier's constructor / surface init**. Seeding a document is birth work, not reset work.

This is not cosmetic: `about:blank`-origin documents stay in BackCompat unless re-seeded, and a
DOM-inserted DOCTYPE does not flip the mode (`standardsBlankDocument.ts:4`). Quirks mode is a **silent K4
failure** — it does not show up in a protocol test, it shows up as "the site looks wrong".

---

## 8. ContextBus — **DECIDED: MessagePort**

**DECIDED (Rodrigo):** directed `MessagePort` transport. **Broadcast rejected.**

Provenance: an earlier position argued the bus must always broadcast because it “cannot know” the
destination. That does not match the design’s actual edges:

- **upward** is `window.parent` (or SW for root); reply targets `event.source` on the setup message;
- **downward** is `childScopes.forEachLiveWindow()` — already enumerated.

Arbitrary addressing (context 7 → 12) is not in the design. Broadcast would cost O(N) `postMessage` per
message and expose MAIN-world traffic to site / ad listeners.

**Normative setup (bus port handshake — not `initContext`):**

1. Child → parent `postMessage` (“open channel”).
2. Parent creates `MessageChannel`, transfers `port2` in the reply, keeps `port1`.
3. All further traffic (including `initContext` / mint / control) rides the ports only.
4. Inner navigation: parent **closes** the old port → dead install cannot forward frames.

Root: same pattern with the service worker as upward peer (via the isolated bridge already used by plane).

---

## 9. Vocabulary — "epoch" has four tenants

`grep -i epoch` outside `node_modules` returns ~150+ hits. Most are **not** the opcode.

| Name | Changes when | Layer | Producer today |
|---|---|---|---|
| `pageEpochId` | **every** NavCommit — hard nav **or SoftNav** ("a page view") | telemetry | **none** |
| `documentEpoch` | only when the **document** is replaced (SoftNav keeps it) | telemetry | **none** |
| `generation` | only when the document is replaced | **protocol (on the wire)** | live |
| `sinkEpoch` (`EventBridge.ts:107`), `frameEpoch` (`LiveSession.cs`) | unrelated concepts | — | — |

**Decisive evidence** — `Telemetry/Events/Services/Contracts/ISessionPageProjectionVirtualTelemetryEvents.cs:6`:

```csharp
void NavCommit(string pageEpochId, string? url, long generation, string? documentEpoch,
               string navigationType, long tVirtualMs);
```

All three are separate parameters of the same event. And
`Telemetry/Events/Models/Sessions/PageProjection/Frame/SoftNavObserved.cs:13`:

> "Main-frame navigatedWithinDocument / **same documentEpoch** soft nav (**no generation bump**)."

**Therefore: unifying `pageEpochId` with `generation` would be wrong and would break SoftNav.** A SPA
navigation (Eneba) would bump `generation`, and under the new rule that means tearing down and rebuilding
the entire table on every `pushState`. Large regression, and semantically false — the document did not
change.

**The real duplicate is `documentEpoch` ≈ `generation`** — same concept, two names, two layers. With
`generation` minted per install, `generation` **is** the document install id, so `documentEpoch` is
redundant by construction.

### The larger finding: this telemetry surface has no producer

- `onPageProjectionParity` is called from **exactly two** places, both
  `parity_session_pool_acquired` / `parity_session_pool_released` in
  `patchright/PatchrightBrowserSession.ts:216` and `:225` (legacy tree). **No `pageEpochId`-keyed event is
  emitted by anything.**
- `onPageProjectionGenerationBumped` is **declared and never called** — zero producers.
- `pageEpochId` / `documentEpoch` appear in no `.ts` that produces a value; only declarations
  (`BrowserSession.ts:87`, `EventBridge.ts:305`) and the C# side, which only **reads** from JSON
  (`PageProjectionParityTelemetryJournal.cs` — ~22 `Required(root, "pageEpochId")`).

So ~150 occurrences — 72 in `SessionTelemetryEvents.cs`, the journal parser, the
`ISessionPageProjection*TelemetryEvents` contracts, `web/src/features/admin/configurations/telemetrySessionEventsCatalog.ts`,
`page-projection-oracles/o3-budgets.cjs`, `build-page-epoch-story.cjs` — are **scaffolding built for the
legacy path that the greenfield `mirror/projection/` tree never wired.**

This is not a rename. It is a decision about dead code: **rewire it with the corrected vocabulary when the
greenfield tree emits telemetry, or delete it.** As it stands it is the surface that makes someone open the
admin, see everything empty, and conclude telemetry is broken — when it was never connected.

**DECIDED vocabulary (with §0):**

- `generation` — protocol, document install. **Keep.**
- `initContext` — acquire `{ contextId, generation }`. **Keep this name.**
- `pageEpochId` — telemetry page-view (includes SoftNav). **Do not unify with `generation`.**
- `documentEpoch` — redundant with `generation` once install-scoped; prefer `generation` on the wire; retire duplicate producers when rewiring telemetry.
- Dead scaffolding (`onPageProjectionParity` unused, etc.) — rewire or delete; do not leave admin empty as “broken.”
- `documentEpoch` — same concept, different name. **Delete**, use `generation`.
- `pageEpochId` — a genuinely different and legitimate concept (a page view, SoftNav included), but the
  name now collides. Rename to something like `pageViewId`.

**Warning:** a blind find-and-replace on "epoch" will also hit `sinkEpoch` (Control-stream attach counter)
and `frameEpoch`, which are unrelated to all of the above.

---

## 10. Deletion inventory

Everything below exists only to detect or compensate for boot failure, which stops being a possible state.

### Sidecar

| File | Lines | Fate |
|---|---|---|
| `browser/mirror/projection/inject/projectionRuntimeInstaller.ts` | 410 | **whole file** — lateBoot, probe, settle, coalesce, `documentAttemptKey`, `evaluateMainWorld*`, `cdpForFrame`, `registeredSessions`, `attachFrameForTest` |
| `inject/injectSentinel.ts` | 64 | **whole file** — sentinel marker/comment, `INJECT_ARM_GLOBAL`, `wrapInjectWithArm`, `buildInjectArmJs` (already `@deprecated`), `buildScrubPreludeJs`, `buildInjectRuntimePresentExpression` |
| `inject/buildProjectionInjectBundle.ts` | 84 | **whole file** — string concatenation becomes a file on disk; `wrapPreludeIife` and the unkeyed `cachedBundle` go with it |
| `inject/loadInpageScript.ts` | 49 | **whole file** — reading `virtual.js` into a string with an mtime cache; the browser reads the file now |
| `inject/buildConfigPreScript.ts` | 83 | **partial** — `buildConfigPreScript()` dies; **`buildConfigPayload()` stays** as SessionConfig shape/validation for C2 |
| `inject/index.ts` | 38 | `loadVirtualInjectionScripts` + `VirtualInjectionScripts` dead |
| `session/frameCdpSession.ts` | 75 | projection use dies — **verify** whether the CSP Document Response hook still needs it |
| diag | — | `SPECULUM_DIAG_BOOT`, `bootDiagSidecar`, all `lateBoot_*` events |
| tests | ~370 | `projectionRuntimeInstaller.unit.ts` (208), `frameCdpSession.unit.ts` (49), `buildProjectionInjectBundle.unit.ts` (102), `injectScriptBodies.unit.ts` (9) |

### Virtual (`packages/page-projection/src/virtual/`)

| Location | Fate |
|---|---|
| `bootstrap.ts:177-189` | `scrubSpeculumInjectScripts()` + `document.currentScript?.remove()` — a content script creates **no DOM node**; there is no orphan `<script>` to clean and no `currentScript`. Removing this also removes the risk of the scrub deleting one of the site's own `<script>` tags. |
| `bootstrap.ts:191-228` | the double-boot guard: `hasProjection` / `hasBootPromise` / `__speculumProjectionBoot` |
| `bootstrap.ts:263-274` | the spin-wait (see §11 V1) |
| `bootDiag.ts` | 59 lines, whole file — plus `__speculumBootDiag`, `__speculumBootDiagLines`, every `bootDiagLog` call site, and `diagBoot` in the config |

### Protocol

See §7.

### The count that matters

Four guards in series against "run zero or twice" — `registeredSessions` (target), `lateBootAttempts`
(frame + gen + url), `__SPECULUM_PP_INJECT_ARMED__` (heap), `__speculumProjectionBoot` (heap) — become
**zero**. The browser guarantees exactly one execution per document. "Boot miss" stops being a possible
state, so it does not need detecting, telemetering, or compensating. That is why `bootDiag.ts` goes with
them: it exists to observe a phenomenon that ceases to exist.

**Order of magnitude: ~1,200 lines removed**, one opcode, one ordering rule, one RPC round-trip class.

---

## 11. What must be verified or measured before / during implementation

| # | Item | Why it matters |
|---|---|---|
| **V1** | **Depth ≥ 2 is suspected broken today.** `bootstrap.ts:263-274` spins on `window.parent.__speculumProjection?.contextId === CONTEXT_ID_ROOT`. In a grandchild the parent is nested with `contextId ≥ 2`, so `parentReady` never becomes true. It is also **unbounded** — a child whose parent never boots spins forever at 16 ms. Confirm before migrating: the extension will make far more nested contexts actually boot, exposing this. |
| **V2** | **`pendingHosts` retry driver.** When mint returns `null`, `tableFrameBuilder` adds the host to `pendingHosts` and drops it from the frame. What re-drives admission? If the driver is "next mutation", a quiet page can strand a host indefinitely. |
| **V3** | **Stealth.** Spike **before** carrier cutover (§0 #10). If critical antibot breaks → stop; no CDP fallback. |
| **V4** | **`Extensions.loadUnpacked` once (C2).** Still verify the existing one-shot path on Chrome 152 (detach after install). Per-session unpack **out of scope** (C1 rejected). |
| **M1** | **Content-bearing `about:blank` / `srcdoc` frames** on `www.belezanaweb.com.br` and Eneba — count them. Note: today's `lateBoot` **skips `about:blank` explicitly** (`projectionRuntimeInstaller.ts:245`, `reason: 'blank_url'`; also `resolveLaunchScripts.ts:163`) and **no fixture covers it** (every `lab/fixtures/iframe-*.html` uses a real `src`). This is a pre-existing, unmeasured hole — not something the extension introduces. |
| **M2** | **Sandboxed opaque-origin frames.** Does `match_origin_as_fallback` reach `sandbox="allow-scripts"` without `allow-same-origin`? If Chrome does not run the CS → dormant (§0 #9). Unverified. |
| **M3** | **`bfcache`.** **DECIDED:** `pageshow` (persisted) → re-setup MessagePort if needed + **`initContext`** again. Implement with carrier; not optional. |
| **M4** | **Cost of reaching more frames.** Measure; **thin bootstrap out of V1** (§0 #11). |

---

## 12. Sequencing

1. **P0, decoupled.** Missing catch on OOPIF attach (`registerOnCdpSession` / `frameattached` / initial
   `Promise.all`). Must not wait for the carrier swap.
2. ~~Resolve §8 / §4~~ — **done** (§0 seal 2026-08-29).
3. **Verify V1 and V2** (depth ≥ 2 parent-ready; pending mint → no emit that tick).
4. **V3 stealth spike** — can reverse carrier only by explicit stop, not by silent fallback.
5. Implement: static one-extension + C2 config gate → `Runtime` / MessagePort ContextBus / `init` +
   `initContext` → generation on wire → protocol removals (§7) → deletion inventory (§10).
6. **§9 (vocabulary / dead telemetry)** independent; any time.

---

## 13. Explicitly out of scope / do not do

- **`point_outside_node`.** Layout isomorphism (UA, fonts, CSSOM), unrelated to injection. Do not fold in.
- **`session.navigate(final url)` after "Visit Site"** just to make a run go green.
- **Click coordinate clamping.**
- **A second HTML-tag injection path.** The Document Response hook remains CSP surgery only.
- **Coupling the P0 catch to the carrier swap.**
- **Building the parallel opcode accumulator** for a `contextId`-per-install update (see §6).
- **Building the small-bootstrap split** before M4 is measured.
- **Blind find-and-replace on "epoch"** — it will hit `sinkEpoch` and `frameEpoch` (§9).

---

## 14. Constraints this redesign must not violate

From [engine-redesign.md](../archive/engine-redesign.md) and [acceptance.md](acceptance.md):

- **K1** never pixel/video · **K2** session state never shared (except public credential-free bytes on L2) ·
  **K3** ≥100 sessions · **K4** 1:1 parity · **K5** site JS only on Virtual.
- A green protocol is not acceptance. `ok: true` on an intent is enqueue, not delivery.
- Effect asserts, not smoke. A missing JSON property is a failure, never a skip.
- No `Task.Delay` as the primary Act→Assert synchronizer.
- Catalogued failures need a stable `errorCode` + `phase`.

And the working rule for this whole redesign, in Rodrigo's words:

> "Nós não vamos fugir da complexidade; não vamos fazer código adhoc. Pagamos custo de complexidade onde
> faz sentido."

A proposal that simplifies by deleting capability is rejected. Everything deleted in §10 is compensation,
not capability.

---

# 15. Implementation review — 2026-08-29 (amended same day)

Original Opus review of the cutover working tree. **Amendments (Rodrigo):** B1 + hygiene landed;
**B2 / `managedTabId` rejected and deleted** (1 session = 1 tab; single-tab law only). B3 remains
out of band until reproduced on `main`.

---

## 15.1 Blockers

### B1 — `c2-endpoint.json` shared — **FIXED 2026-08-29**

Was: every session wrote `c2-endpoint.json` into the shared template dir → concurrent sessions
could steal each other's C2 host / token.

**Fix:** `materializeSpeculumPpForSession` copies the template to
`os.tmpdir()/speculum-extensions/<sessionId>`, C2 writes the endpoint there, `loadUnpacked` uses
that path, `removeSpeculumPpSessionDir` on stop. Unit: two hosts + two dirs assert distinct
endpoint URLs (`extensionC2Host.unit.ts`).

### B2 — managed-tab gate — **REJECTED / DELETED 2026-08-29 (Rodrigo)**

Opus flagged fail-open `managedTabId`. Product law is **1 session = 1 Chrome = 1 tab**; the
`managedTabId` protocol was overengineering. Removed from SW + `ExtensionSessionConfig`. Residual
risk of a stray tab is owned by single-tab (sidecar + MAIN), not a C2 tab-id field.

### B3 — a .NET test is failing — **OPEN (ownership unknown)**

`Speculum.Api.Sessions.Tests.SessionCollectorTests.TimedOut_DoesNotFireAfterReattachClaimRace`
— reproduce on `main` before attributing to this cutover. Not softened.

---

## 15.2 Hygiene — **CLEARED 2026-08-29**

- **H1:** gitignore `speculum-pp/main/virtual.js` + `c2-endpoint.json`; template endpoint deleted.
- **H2:** `extensions/webgl-spoof/` and `extensions/speculum-plane/` removed; deprecated path
  helpers gone; LNA unit asserts `speculum-pp` only.
- **H3:** `inject-extension-draft.md` deleted.

---

## 15.3 Verification still owed

| Item | Status |
|---|---|
| **V3 — stealth spike** (§11) | Still required before accept. |
| **M4 — establish baseline** (§11) | Measure vs git history of pre-cutover carrier if needed; not a cutover blocker. |
| **SW idle survival** | Heartbeat + content-script Ports; verify idle SW restart. |
| **Two-session concurrency (live Chrome)** | Unit isolates endpoint files; full two-Chrome proof still useful before density claims. |

---

## 15.4 Withdrawn / rejected — do not reopen

- **Mint block allocation** — rejected; root mints sync (`childScopes.ts`); nested holds frame.
- **`managedTabId` / B2** — rejected; do not reintroduce.

---

## 15.5 Confirmed correct — do not "fix" these

- P0 OOPIF catch + `frameCdpSession` kept for CSP hook.
- Opcode `0x02` retired; Projected teardown by generation.
- `initContext` asymmetric timeouts; `init()` observer/bus before await; `mintHeld`; bfcache
  re-`initContext`; `chrome.storage.session` for config/generation; fail-closed C2 ACK before navigate.

---

## 15.6 Exit criteria (remaining)

1. ~~B1~~ done.
2. ~~B2~~ rejected/deleted (not a fix target).
3. B3 — reproduce on `main`, then fix or attribute.
4. ~~H1–H3~~ done.
5. Maintainer gates: `sidecar npm test` / build, relevant `dotnet test`, web gates as usual.
6. V3 stealth spike with criterion fixed beforehand.
7. M4 when useful (history checkout OK).
8. Optional live two-session Chrome proof (unit already covers endpoint isolation).

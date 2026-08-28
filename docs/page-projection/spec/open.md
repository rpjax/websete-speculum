# PageProjection — open items (bugs, gaps, rulings)

**Status:** living tracker. Single place for a weaker agent to see what is **not** done.  
**Do not** treat a missing row here as permission to invent a workaround. If you find a new defect, **append**.  
**Protocol OPEN-* source of truth** remains the table in [frame-protocol.md](frame-protocol.md) §10; this file copies it plus product/cutover items.

---

## How to use

| Kind | Meaning | Ship rule |
|------|---------|-----------|
| **BUG** | Implementation violates a sealed V4 rule | Must fix before production cutover if tagged **cutover-blocker** |
| **OPEN-n** | Design question in frame-protocol §10 | Do not implement a guess; ask |
| **RULING** | Human decision required (Rodrigo) | Do not pick in code |
| **RESIDUAL** | Docs/tests/budget leftover, not a protocol hole | Can trail cutover unless tagged blocker |
| **PINNED** | Deferred on purpose | Do not pull forward without a site that needs it |
| **ACCEPTED GAP** | Product boundary | Listed in [support-matrix.md](support-matrix.md) — not a bug |
| **SEAL gap** | Current emit/apply path is wrong or unsealed | [seal-gaps.md](seal-gaps.md) §2. Unimplemented opcodes/walks are **features** (§3), not gaps. Live cutover is the **destination** ([roadmap.md](roadmap.md)), not a row there |

---

## Bugs

**OPEN-8** is closed at the table. `takeRecords` before drain is closed. CLI `--iso` proves Virtual O2 + Node table×table; tree×tree needs lab UI DOM apply. **Production cutover is not licensed** by that — see [roadmap.md](roadmap.md) cutover law.

No open DOM-table bugs. Stress-churn stacked digits = PP-FR-1 ([observability.md](observability.md) §8). Prepend `child_order` = green at seq 799 (`2026-08-15T00-32-28`). Lab tracker (QA → gaps → features): [seal-gaps.md](seal-gaps.md) — not table OPEN-*. Apply honesty P0 is closed (UI desync attr/ruleset/eof 2026-08-17). SVG namespace **closed 2026-08-17**. Form `PROP_SET` **closed 2026-08-18**. Open named shadow **closed 2026-08-18**. Same-origin nested iframe **lab shipped 2026-08-19** (`iframe-open`). **OPEN-6 observability shipped 2026-08-19**. CSSOM in nested contexts = **same algorithm instance** (not a separate feature). Remaining OPEN-6: XO / srcdoc / sandbox / fenced (NIT). Optional QA: nested `cssomO2` assert — [seal-gaps.md](seal-gaps.md) `SEAL-CSSOM-P2-NESTED-QA`.

### BUG — locale popup / `_blank` skips CSP surgery (**CLOSED 2026-08-27**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-CSP-SINGLE-TAB** | After clicking a locale/OAuth-style popup (`target=_blank` / `window.open`), `input_reject … data plane not open`; console: `ws://127.0.0.1` violates `connect-src`. | **Session law:** one tab only — open/_blank → same-tab redirect; orphan page closed immediately. Fix: `session/singleTab.ts` + CSP hook hardening. Fixture `csp-nav-locale-*.html` · lab blueprint `csp-nav-locale` · unit `runSingleTabLocaleCspPlaneUnitTests`. |

### BUG — huge Document + meta-only CSP blocks loopback (**CLOSED 2026-08-27**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-CSP-META-HUGE** | Binance-class live: `ws://127.0.0.1` violates strict `connect-src`; `data plane not open` on cold load or post-nav. HTML huge; CSP enforcing only via `<meta http-equiv>` when `Fetch.getResponseBody` fails. | Fix: `cspMetaNeutralizeInitScript.ts` (drop meta CSP before parse) + `continueWithHeaders` no silent fallback · unit `runMetaOnlyHugeCspPlaneUnitTests` · diag `diag-csp-huge-nav.js` (`meta-only`). Related: **PP-CSP-SINGLE-TAB** (popup path). **Residual plane desync** → **PP-LOOPBACK-ESTABLISH** (not CSP). |

### BUG — loopback establishment / ghost socket (**CLOSED 2026-08-27**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-LOOPBACK-ESTABLISH** | `input_reject … data plane not open` while Virtual reports WS open; sidecar `isOpen=false`; attach churn after nav. | **Fix:** [loopback.md](loopback.md) LB-08…19 — handshake `hello`/`hello-ack`, symmetric `establishConnection`/`waitEstablished`, canonical socket, `detach(true)`. Units: `nodeDataPlane.unit.ts`, `runDataPlaneNavChurnUnitTests`, `chromeLnaPolicy.unit.ts`. LNA policy-only (`["*"]`). |

### BUG — virtual assets / third-party framed identity (PINNED 2026-08-25)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-ASSET-XFO** | Lab console: `Refused to display 'https://id.unico.io/'` / `idpay.unico.io` — `X-Frame-Options: sameorigin` + `403` | Projected nested browsing contexts that point at Unico (and similar IDP/pay iframes) cannot load in a frame under Speculum’s origin. Not an asset-byte bug — **XO / third-party frame policy**. Treat with OPEN-6 XO work later; do **not** punch `X-Frame-Options` as a workaround. Observed Superbet lab 2026-08-25. |

Virtual-assets V1 path (rewrite + L1 + stamp + Lab/Live serve) is otherwise **working** — stress/harden separately; this row is the Unico/XFO pin only.

### BUG — injected `virtual.js` on third-party origin (OPEN 2026-08-27)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-INJECT-THIRD-PARTY-MIME** | Lab console: `Refused to execute script from 'https://widget.trustpilot.com/__speculum/virtual.js' because its MIME type ('text/html') is not executable` | Document inject writes `/__speculum/virtual.js` (or relative). On third-party nested docs (Trustpilot widget, etc.) the browser resolves against **that** origin; request hits the real host → HTML 404/SPA shell → strict MIME refuse. Stored-script Fetch fulfill is supposed to catch this (unit already covers CF-shaped URL); Trustpilot path still leaks. **Not** input pipeline. Related: OOPIF/frame CDP Fetch attach ([csp.md](csp.md) 2026-08-27). Do **not** “fix” by punching MIME or serving JS from Trustpilot. Observed lab 2026-08-27. |

### BUG — Projected nested load-after-drop census ghost (**CLOSED 2026-08-27**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-INPUT-NESTED-DROP-LOAD** | After iframe churn, click dead; S6 census includes orphan `contextId`; Phase A ~2s timeout or ABS never fires | `dropNestedHost` cleared `nestedHostAwaitingLoad` but left the `load` listener → late bind → ghost in `ProjectedInputRuntime`. **Fix:** `cancelPendingNestedHost` (flag + `removeEventListener`) + drop pending frames. [multi-document.md](multi-document.md) §4.1 · [input.md](input.md) §4. Repro: `diag-click-ghost-context.js`. **Not** the same as Virtual mint-without-dropHost (wire ghosts in census `[1,N]`). |

### BUG — Virtual mint-without-drop census hang (**CLOSED-BY-DELETION 2026-08-27**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-INPUT-VIRTUAL-MINT-GHOST** | (was) Real site clicks die via `apply_scroll_failed:invoke idle timeout` on OS census path. | **Closed by deletion** (OS census) + **live deliverable index 2026-08-27:** `isDeliverableDestination` is now child-scope live (`windowOf`), not `hasMinted`. Carrier routes O(1) via index — no DOM `querySelectorAll` / hopeful broadcast. |

### BUG — nested iframe lab click oracle (`input-iframe-click`) (OPEN 2026-08-27)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-INPUT-IFRAME-CLICK-NESTED** | Lab blueprint `input-iframe-click` (`contextId=2`, `#inner-click`) fails `keyOfSelector` → **`node_unmapped`**. Root + real-site (Eneba) sparse input **proven**; nested oracle regressed or timing/identity gap. Not a V1 sparse seal blocker. Fixture `iframe-open.html` · repro: `docker compose … exec lab node dist/…/cli.js --blueprint input-iframe-click --headed`. |

**Lab (2026-08-15 / 2026-08-16):** CSSOM poll **algorithm** — [cssom-poll-algorithm.md](cssom-poll-algorithm.md).
**Accept:** DOM numerical 1:1; CSSOM live perceived ([acceptance.md](acceptance.md)).
Why: [cssom-sensor-journey.md](cssom-sensor-journey.md). `SHEET_*`/`RULE_*` are on the wire (phase 1
table). **C6 lab apply is shipped** for constructed sheets on `adoptedStyleSheets` + `CSSStyleRule`
(`client/applyDom.ts`). Child-document CSSOM is OPEN-6 — [multi-document.md](multi-document.md). Conditional CSSOM seal ≠ production cutover —
kill list: [seal-gaps.md](seal-gaps.md). Telemetry `cssomPoll` sealed for the foundation —
[observability.md](observability.md) §9 (idle + resync + snapshot scan). **No** CDP CSS domain. **C5 = poll**
(canonical 2026-08-18). Nested inners ride grouping `cssText` (own-row walk = later opt). C6 apply telemetry is **not** the foundation cut.

---

## Protocol OPEN-* ([frame-protocol.md](frame-protocol.md) §10)

| # | Question | Status |
|---|----------|--------|
| **OPEN-1** | `NODE_DROP` of an absent id: `malformed` vs tolerated? | **CLOSED 2026-08-17 — `malformed`.** Unit `testApplyFrameToTableCheckedRejectsNodeDropAbsentId`. |
| **OPEN-2** | Detached-row lifetime | **CLOSED 2026-08-17** — end-of-tick move/detach, deferred `lms`-age GC (`NODE_DROP_AGE_SEQUENCES` = 20), no per-row versioning. |
| **OPEN-3** | `CHECK.scope` granularity | **CLOSED 2026-08-17** — id ranges (§4.1). Units: `testApplyFrameToTableCheckedRangeScope`, `testCheckScopeRangeEncodeDecode`. |
| **OPEN-4** | Establish HTML vs table | **CLOSED — moot.** Establish deleted (§4.7). |
| **OPEN-5** | Recovery / mid-session attach | **CLOSED — §5.8.** Residuals below. |
| **OPEN-6** | Multi-document | **Lab same-origin iframe + observability shipped 2026-08-19** — [multi-document.md](multi-document.md). XO / `srcdoc` / sandbox / fenced NIT. Child-doc CSSOM feature open. **Production not cutover.** |
| **OPEN-7** | `insertBatch` reverse-link | **CLOSED** — `nextSiblingOf.set(prev, before)` on insert-before-existing; unit falsifier in `unit.ts`. |
| **OPEN-8** | `unlink` last-child leaves `nextSiblingOf[prev]` | **CLOSED 2026-08-14** — tail REMOVE after prepend; see frame-protocol §10. |

---

## Rulings (do not decide in code)

| Id | Topic | Why it blocks | Notes |
|----|-------|---------------|-------|
| **CUTOVER-FULL** | Production cutover completeness | Live switch when V4 is the **only** path with **CSSOM + shadow + OPEN-6 + OS unified input + canvas** on Live — then Integration. Nested CSSOM is not a second algorithm. DOM-only lab is not M1. Input hot path = EventApplier + registered v0 adapter (`os-abs`) ([input.md](input.md)); Mode A/B CDP purged 2026-08-26. | [roadmap.md](roadmap.md) |
| **CUTOVER-SESSION** | Session sealed mirror contracts on Live | **DONE (shape 2026-08-21)** — `PageProjectionBrowserSession` + sealed factory; product gaps remain (antibot/assets/…). | [browser-session.md](browser-session.md); [roadmap.md](roadmap.md) gate 6.6 |
| **E-03 / E-08** | Loopback WS data plane (canonical) | **REVISED 2026-08-26 — loopback WS is the sole Virtual↔sidecar carrier** (lab and Live). CDP `exposeBinding` data plane **purged**. Surgical Document CSP Response-stage surgery remains normative for Virtual script/`connect-src`/nonce — see [csp.md](csp.md). **Still rejected:** blunt CSP/`connect-src *` / disable-PNA *punch* as an antibot-visible enablement hack — surgery is surgical, carrier is still page loopback WS. Inject = Playwright `addInitScript` + Document producer mutator. | [csp.md](csp.md) · [roadmap.md](roadmap.md) gate 8 · [browser-session.md](browser-session.md) |
| **Contracts pack fate** | Archive vs delete historical `contracts/` + `implementation/` | Already moved to `archive/`. Confirm deletion vs keep-for-provenance. | Default this pass: **keep in archive**, never implement from. |

---

## Residuals (docs / tests / budgets)

| # | Item | Blocker? |
|---|------|----------|
| 1 | Pre-V4 prose in adjacent layer files. **[input.md](input.md)** — OS unified hot path banner; historical CDP body not for implement. **[cssom.md](cssom.md) still pending** — "establish/install" CSSOM vocabulary needs a careful separate pass (sheet-snapshot semantics). | No — agents follow banners |
| 2 | [test-matrix.md](test-matrix.md) `PP-EST-*` / `PP-REC-2/3` / some `PP-FR-*` still named for childList/establish — **re-authored in place as V4 intent** this pass; WP exit table still historical | Prefer before MotorAssert live-path coverage |
| 3 | Synchronous-walk latency budget at `MAX_ROWS` for `resyncVirtual` (not `emitResyncFrame`) | Before relying on walk-based rebuild in production at huge tables |
| 4 | `contracts/07-recovery.md` full rewrite | **Dropped** — file archived; §5.8 is the spec |
| 5 | Bounded resync retry on **production** session layer with catalogued `errorCode`+`phase` | Lab root + nested Projected clients have 3-attempt backoff + `resyncFailed{exhausted}`. Production: **`requestResync({ contextId?, reason? })`** → producer `emitResyncFrame` → client awaits frame on data plane. No get-pull / no sendControl bag. **Contract SEALED** — [browser-session.md](browser-session.md). |
| 6 | Dual live paths (`LivePageProjection` vs lab engine) | **DONE (path)** — sealed factory + stub-delete LivePageProjection; product canvas/antibot still open |
| 7 | Lab probe: `NODE_NEW` in frame S ⇒ `isConnected` — **closed** as **SEAL-DOM-P0-PROBE** (`frameNewNodes` / legacy `probe.nodeNewConnected` + `iso.tree` fail-with-client). Halt iso alone still does not prove the class. | No |
| 8 | Lab DOM/CSSOM tracker | [seal-gaps.md](seal-gaps.md) — nested SO closed 2026-08-19. Open: XO/NIT; nested cssomO2 QA; CSS paint iso; scale. |

---

## Accepted product gaps

See [support-matrix.md](support-matrix.md). Canvas/WebGL pixels, MSE/DRM, IME, timing-critical games, independent client zoom. **Iframes:** lab same-origin is shipped. Pierced XO iframes stay **unsupported** (NIT) until that cut — not “working.”

---

## Closed recently (do not reopen)

| Date | Item |
|------|------|
| 2026-08-13 | Establish deleted; cold start = resync frame |
| 2026-08-13 | OPEN-5 recovery design |
| 2026-08-13 | 48 KB first-frame = injected `<script>` leak; `currentScript.remove()` |
| 2026-08-13 | `resolvedBefore` O(N²) → `walkSiblingRun` |
| 2026-08-14 | NODE_DROP subtree resurrection + same-tick reattach race |
| 2026-08-14 | Stage 4 lab: client resync + real double buffer; `everArmed` cold-start vs mid-session |
| 2026-08-14 | Spec tree reorganized to V4 live + `archive/` |
| 2026-08-14 | OPEN-7 `insertBatch` reverse `nextSiblingOf` — fixed + unit falsifier |
| 2026-08-14 | O2 local oracle (table × live DOM) wired in lab |
| 2026-08-14 | Lab Chromium path folded into `V4ProjectionBrowserSession`; lab is caller only |
| 2026-08-14 | Torn O2 (split `page.evaluate`) → `flushAndSnapshot` one JS turn |
| 2026-08-14 | Telemetry-as-assert (`table_size_matches_telemetry`) removed; digest probe at sequence S |
| 2026-08-14 | OPEN-8 `unlink` last-child `nextSiblingOf[prev]` — prepend-stress O2 / table walk `[118]` |
| 2026-08-14 | PP-FR-1 V4 walk (`!isConnected` at drain); stress-churn stacked digits; phase-2 `REMOVE` desync |
| 2026-08-14 | prepend-stress O2/tree at halt — green seq 799 (OPEN-8 / takeRecords era; not a live bug) |
| 2026-08-16 | Lab seal kill lists: [seal-gaps.md](seal-gaps.md). Doc falsehood: C6 phase-2 “still no-op” corrected (constructed/`adopted` + `CSSStyleRule` shipped in lab) |
| 2026-08-17 | Inject honesty ATTR/RULESET/EOF: harness, not apply. UI 4077 PASS. [observability.md](observability.md) §7 |
| 2026-08-17 | QA closed (human looks + CHECK range + CSSStyleRule folds + detached-row GC / OPEN-2 / OPEN-3). SVG namespace closed same day. Next: [seal-gaps.md](seal-gaps.md) §3 |
| 2026-08-17 | OPEN-1 **CLOSED** — `NODE_DROP` absent id is `malformed` |
| 2026-08-19 | OPEN-6 lab same-origin iframe shipped — `iframe-open` `iso.nested` / `iso.nested.blank`. XO/srcdoc NIT. |
| 2026-08-19 | **OPEN-6 observability shipped** — telemetry v2 + `contextId`, bus snapshot RPC, lab context index, iso N-way, Stream HUD per context ([observability.md](observability.md) §10). |
| 2026-08-21 | **BrowserSession contract SEALED** — [browser-session.md](browser-session.md): core + PP + video; raw `getStateSnapshot`; `requestResync` only; no diagnostics facade. |
| 2026-08-19 | **Resync single entry path** — `PlaneChannel.Control` `requestResync` only; removed `emitResyncRequest` / upward loose bus / empty `forwardResyncToSidecar` stub. |
| 2026-08-19 | **`parityFingerprint` removed** — not in telemetry v2 schema; iso probes are the assert source. |

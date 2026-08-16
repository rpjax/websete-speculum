<!-- V4 2026-08-14 -->
> Coverage truth for the V4 engine. Index: [README.md](README.md). Effect asserts only.
> Rows that still say childList/establish/Node-mirror were **re-authored below** to V4 opcodes.
> `PP-F-4` (pierce iframes) is **OPEN-6** — fail as unsupported, do not fake a pass.
> `PP-DEN-1` remains unrun. Budgets: [budgets.md](budgets.md). Oracles: [oracles.md](oracles.md).

# PageProjection — test matrix

**Status:** coverage truth for V4. Canon: [frame-protocol.md](frame-protocol.md) + [budgets.md](budgets.md).
Style: `Speculum.MotorAssert.Tests/MATRIX.md`. WP column is historical packaging, not a second spec.

Every row below MUST be an effect assert. `200` / `ok: true` / a delivered frame count never proves a
row — see [assert-failure-policy.md](../../assert-failure-policy.md) and the always-applied workspace rules.
No row may be softened, skipped, or declared PASS from protocol-only signals.

A package (`WP`) is complete when **all** its `PP-*` rows pass and **all** its referenced budgets
(`P1`–`P7`, `E1`–`E11`) hold — not when the code is written, not when most tests pass.

| ID | Assert | WP |
|----|--------|----|
| `PP-ID-1` | No `speculum-anchor` or `speculum-last-mutation-sequence` attribute exists in the Virtual DOM at any point in a session | WP3 |
| `PP-ID-2` | Cloning a published node yields a distinct id; no duplicate ids are ever emitted | WP3 |
| `PP-ID-3` | Text and comment nodes receive ids and are addressed directly; no `childAt` form appears on the wire | WP3 |
| `PP-ID-4` | The reverse id map releases detached nodes; it does not grow without bound over a 5-minute soak | WP3 |
| `PP-F-1` | Projected tree is structurally isomorphic to `F(Virtual)` after settle (O2) | WP3 |
| `PP-F-2` | Adjacent text nodes are published 1:1 without collapsing; the client never calls `normalize()` | WP3 |
| `PP-F-3` | Slotted shadow content publishes the flattened rendered result | WP3 |
| `PP-F-4` | Closed shadow roots and cross-origin iframes are pierced and published | WP3 |
| `PP-F-5` | `<title>`, `lang`, `dir` and `meta viewport` are projected; an RTL page renders RTL | WP3 |
| `PP-D16-1` | `showModal()` on Virtual produces a modal dialog on Projected: top layer, backdrop, inertness | WP11 |
| `PP-D16-2` | Popover shown on Virtual is shown on Projected | WP11 |
| `PP-D16-3` | Media pause / seek on Virtual is reflected on the client's media element | WP11 |
| `PP-D16-4` | `setCustomValidity` makes `:invalid` match on Projected | WP11 |
| `PP-FR-1` | A node created and destroyed within one frame is never sent. **V4 walk (2026-08-14):** drain `!isConnected` ⇒ no `NODE_NEW`/`INSERT`. Lab snapshot probe (`NODE_NEW` ⇒ connected) not built yet — halt iso is blind to this class ([observability.md](observability.md) §8) | WP4 |
| `PP-FR-2` | A 200-node subtree rendered in one task produces batched `INSERT`s (sibling runs), not 200 separate parent ops | WP4 |
| `PP-FR-3` | N attribute writes to one node within a frame produce one `ATTR_SET` (or equivalent coalesced op), not N | WP4 |
| `PP-FR-4` | A frame with no operations consumes no `sequence` | WP4 |
| `PP-FR-5` | Records for non-published subtrees are discarded before any identity or payload work | WP4 |
| `PP-FR-6` | Frames applied to the client tree yield a tree identical to Virtual (O2) over a 5-minute soak on a live-odds page | WP4 |
| `PP-FR-7` | With the page not focused, the frame clock still runs at `frameRateHz`; the watchdog fires if it does not | WP4 |
| `PP-FR-8` | A frame exceeding `maxFrameBytes` is split into parts, applied as one transaction; a missing part desyncs | WP4 |
| `PP-MOVE-1` | Moving a node containing a playing `<video>` preserves playback; the node is not destroyed and recreated | WP4 |
| `PP-MOVE-2` | Moving a node containing the focused element preserves focus | WP4 |
| `PP-MOVE-3` | Moving a scrolled container preserves its scroll offset | WP4 |
| `PP-WIRE-1` | The API never parses a frame body; relay cost is O(1) in payload size | WP5 |
| `PP-WIRE-2` | An unknown frame version desyncs, never a best-effort parse | WP5 |
| `PP-WIRE-3` | No `JSON.stringify` / `JSON.parse` of the document tree on the frame path (binary frames only) | WP5 |
| `PP-EST-1` | Cold start is a `resync`-flagged frame; the surface paints after that frame's closing `CHECK` (no HTML establish stream) | WP9 |
| `PP-EST-2` | Cold `resyncVirtual` + apply holds **E2** at 20k nodes | WP9 |
| `PP-EST-3` | Mutations during the bootstrap walk are neither lost nor double-applied (buffer discarded after walk; O2 after settle) | WP9 |
| `PP-EST-4` | Scroll position at first paint is restored before arming (or documented as follow-up if not yet in V4 ops) | WP9 |
| `PP-EST-5` | Pointer intents are not sent before arming; pre-arm clicks are queued or visibly refused, never silently mis-targeted | WP9 |
| `PP-EST-6` | CSSOM rows in the resync frame apply with DOM; no flash of unstyled content from a missing sheet install | WP9 |
| `PP-EST-7` | A resync frame whose closing `CHECK` mismatches is a defect (desync + retry), never a painted partial table | WP9 |
| `PP-SURF-1` | A media query matching in Virtual matches in Projected at the same viewport | WP7 |
| `PP-SURF-2` | `position: fixed` elements stay fixed to the surface viewport on scroll | WP7 |
| `PP-SURF-3` | No script executes in the Projected surface even when a `<script>` is injected into the payload | WP7 |
| `PP-SURF-4` | No CSS text rewriting occurs anywhere in the client | WP7 |
| `PP-SURF-5` | A client zoom or DPR change produces a Virtual viewport update and correct hit-testing afterwards; a stable screen produces zero `Resize` | WP7 |
| `PP-NAV-1` | Hard navigation shows no blank frame; the old document is held until the new one paints (**P6**) | WP8 |
| `PP-NAV-2` | Soft navigation does not bump `generation` and does not re-establish | WP8 |
| `PP-NAV-3` | The retired buffer's registry, owned CSSOM and id map are fully released | WP8 |
| `PP-LOAD-1` | Under induced congestion the frame rate degrades and **no** desync occurs | WP4 |
| `PP-LOAD-2` | `QueueDropped` is zero under sustained overload; drops occur only on genuine faults | WP4 |
| `PP-LOAD-3` | A session with a runaway mutation loop degrades itself and does not affect other sessions | WP4 |
| `PP-LOAD-4` | A client reporting `hidden` drops to `hiddenRateHz` and resumes correctly with no desync | WP4 |
| `PP-REC-1` | Each frame-protocol.md §5.8 desync trigger desyncs, and only those; overload never does | WP6 |
| `PP-REC-2` | Mid-session resync is `emitResyncFrame` (existing identity map); after swap, structural O2 vs Virtual is identical | WP6 |
| `PP-REC-3` | Resync is an in-band frame with normally incremented `sequence`; client adopts it; no watermark side channel | WP6 |
| `PP-IN-1` | Hover, active and focus-visible are visible within **P4** with the network stalled | WP10 |
| `PP-IN-2` | Typing does not move the caret when an upstream value patch arrives (§5.9.3) | WP10 |
| `PP-IN-3` | Scroll paints within **P4** with the network stalled | WP10 |
| `PP-IN-4` | Click to authoritative effect holds **P5** | WP10 |
| `PP-IN-5` | Intents address by `uint32` id and resolve through the reverse map; a miss follows the retry-then-drop policy | WP10 |
| `PP-ASSET-1` | CSS and in-viewport images are fetched before below-fold assets | WP12 |
| `PP-ASSET-2` | A stalled asset degrades that element only and does not delay first paint | WP12 |
| `PP-ASSET-3` | `brokenImgs = 0` and `virtualData1x1 = 0` at settle on the baseline sites | WP12 |
| `PP-ASSET-4` | The per-session L1 cache respects its LRU byte cap | WP12 |
| `PP-ASSET-5` | Two concurrent sessions requesting the same public asset produce **one** origin fetch and **one** stored copy; the second is served at memory speed | WP12 |
| `PP-ASSET-6` | L2 respects its host cap with LRU; eviction while a session holds a reference does not invalidate that session's view | WP12 |
| `PP-ASSET-7` | Signed CDN URLs with differing query tokens key differently — a miss, never a wrong hit | WP12 |
| `PP-ASSET-8` | With a warm L2, session N's **P1** is at least as good as session 1's | WP12 |
| `PP-ISO-1` | A response fetched with `Cookie` or `Authorization`, or marked `private`/`no-store`, or varying on `Cookie`, never enters L2 and is never served to another session | WP12 |
| `PP-ISO-2` | No session state crosses sessions: cookies, storage, CSSOM, DOM, id space and credentialed responses stay per session | WP12 |
| `PP-ISO-3` | An error response is never shared; one session's 404 does not become another's | WP12 |
| `PP-SESS-1` | Session start holds **E10** with a warm pool | WP13 |
| `PP-SESS-2` | A released browser instance is destroyed and never handed to another session | WP13 |
| `PP-TEL-1` | Default telemetry holds **E8**; disabled facts allocate nothing | WP5 |
| `PP-TEL-2` | Every catalogued failure carries `errorCode` + `phase` | WP5 |
| `PP-CSSOM-F-1` | After settle, `cssom: 'scan'` table × live CSSOM (I2 top-level) is identical; DOM O2 still holds with Sheet rows under document | lab |
| `PP-CSSOM-F-2` | `cssom: 'none'` returns no CSSOM oracle; DOM O2 still holds (I8) | lab |
| `PP-CSSOM-F-3` | In-place `rule.style` settle: no `SHEET_DROP` on idle wire; committed table × live identical (I11) | lab |
| `PP-CSSOM-F-4` | `insertRule` / `deleteRule` settle: committed table × live identical | lab |
| `PP-CSSOM-F-5` | `replaceSync` settle: committed table × live identical (abort is evidence, not the assert) | lab |
| `PP-CSSOM-F-6` | Unreadable `cssRules` sheet is not required in the table; readable sheets still match (I7) | lab |
| `PP-CSSOM-F-7` | After `requestResync`, `cssom: 'scan'` table × live identical | lab |
| `PP-CSSOM-H-1` | Heavy magazine fixture: after settle and after theme/accent/feature/reorder/resync, `cssom: 'scan'` table × live identical; no `SHEET_DROP` on in-place theme. Human: Projected 4077 perceived 1:1 with Virtual (masthead, cream/ink, hot card) | lab |
| `PP-DEN-1` | 100 concurrent sessions hold the P1–P6 percentiles (**O4**) | WP14 |
| `PP-DEN-2` | The degradation knee is measured and recorded as a regression metric | WP2, WP14 |

## Work package exit criteria (§10)

| WP | Content | Exit criteria |
|----|---------|----------------|
| **WP1** | Oracles O1, O2, O3, O5 against the current engine | All four run in CI and **fail** on today's engine with the §3 defects visible |
| **WP2** | O4 density harness | Produces a knee curve for the current engine; `PP-DEN-2` records the baseline |
| **WP3** | Identity + registries (§5.1) | `PP-ID-1..4`; O2 still passes |
| **WP4** | Frame model, clock, rate policy, `INSERT`/`REMOVE` batches | `PP-FR-1..8`, `PP-MOVE-1..3`, `PP-LOAD-1..4`; E3, E4 |
| **WP5** | Binary wire, part splitting, relay-only API, telemetry unit (§5.5, §5.15) | `PP-WIRE-1..3`, `PP-TEL-1..2`; E5, E8 |
| **WP6** | Resync recovery (frame-protocol §5.8) | `PP-REC-1..3` |
| **WP7** | Surface as a real document, zoom/DPR (§5.8.1–4, §5.8.6) | `PP-SURF-1..5`; O1 improves measurably |
| **WP8** | Double buffering (§5.8.5) | `PP-NAV-1..3`; P6 |
| **WP9** | Cold resyncVirtual, handoff, arming, CSSOM-in-resync | `PP-EST-1..7`; E2, P1, P2 |
| **WP10** | Local-first interaction, caret, control channel, id-addressed intents (§5.9, §5.11) | `PP-IN-1..5`; P4, P5 |
| **WP11** | Node-state extensions (§5.2.1) | `PP-D16-1..4` |
| **WP12** | Asset plane and two-tier cache (§5.12) | `PP-ASSET-1..8`, `PP-ISO-1..3`; P1 |
| **WP13** | Browser pool + admission (§5.13, §5.14) | `PP-SESS-1..2`; E10 |
| **WP14** | Density calibration | `PP-DEN-1` at 100 sessions; §5.16 knobs set from measurement; E6, E7, E7b, E11 |
| **WP15** | CDP spike | Decision recorded: adopt or reject, with evidence — see `Refactor/sidecar/browser/patchright/mirror/page/CDP_SPIKE.md` |
| **WP16** | Doc closure | Supersession banners, T11/T12 closed, amended contracts updated, §11 published in the support matrix |

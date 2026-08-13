# Dom Projection — input propagation & bindings

> **Amended by** [engine-redesign.md](engine-redesign.md) rev 4
> (WP16 / Q8 / Q14 / Q18): §§6.3 (iframe surface coords), 6.7 (intents address by `uint32` id via
> reverse map — not `speculum-anchor` on Virtual), 7.2 (caret **client-authoritative**), 11 (control
> knobs; coalesce knobs deleted), 14.3 (hit-test / iframe boundary). Local-first interaction
> classification (§5.9) supersedes round-trip-only feedback. Where this file conflicts with the
> redesign on those sections, **the redesign wins**. Remainder of this contract still stands
> (no wire `click`, CDP-only dispatch, inject chain, move collapsing, `setFiles`, disarm while
> desynced, two scroll intent types).

**Status:** design complete (V1 contract) — **aligned with PageProjection seal**
(I1–I5). Cutover rename with T11.

> **Naming / supersession:** product mode/pipe is **PageProjection**
> (`MirrorMode.PageProjection`), not `DomProjection`. **E2E rename includes
> this input contract** — `DomProjectionIntent` → `PageProjectionIntent`,
> telemetry `…PageProjection.Input.*`, mode checks, client/sidecar APIs (T11).
> Sealed Dom/Cssom planes:
> [diff-streams.md](diff-streams.md),
> [cssom.md](cssom.md).
> This file remains the implemented V1 behaviour until cutover (names update
> with T11; no V1 aliases).


**Scope:** how user intent on the **Projected DOM** is captured, sent, and
applied on the **Virtual DOM** — and how upstream control state from F binds
back without fighting the user.

**Not this document:** F (Virtual → DomDiff) —
[diff-pipeline.md](diff-pipeline.md); virtual
asset serve; F coalesce knobs; **video-mirror / OS (uinput) input** — that
stack stays on `MirrorMode.VideoStreaming` and is intentionally separate.

**Related:** [architecture.md](../../architecture.md) · [naming.md](../../naming.md) ·
Sessions `MirrorMode.DomProjection` (→ `PageProjection` at cutover)

---

## 1. Purpose

```
User → Projected DOM (capture) → wire intent → Virtual DOM (CDP dispatch)
                                              ↓
                                         site JS runs
                                              ↓
                                         F emits DomDiff
                                              ↓
                                         Projected DOM updates
```

No site JS on Projected. Antibot-relevant pointer **paths** are remoted over
**CDP only** (never OS/uinput). Control bindings honor F’s
`speculum-input-*` attrs with debounce.

---

## 2. Vocabulary

| Term | Meaning |
|------|---------|
| **Projected DOM** | Client tree from F; Speculum chrome attaches listeners. |
| **Virtual DOM** | Chromium DOM; site JS runs here. |
| **Anchor** | `speculum-anchor` — shared element identity (F). |
| **Intent** | Wire message: `PageProjectionIntent` (today’s code: `DomProjectionIntent` until T11). |
| **Surface** | Projection host content box that maps 1:1 to the Virtual viewport. |
| **Dispatch** | CDP / Patchright apply on Virtual (never OS/uinput). |
| **Binding** | Projected ↔ Virtual control sync via F attrs + debounce. |
| **Inject chain** | Sidecar serialized queue preserving causal order. |

---

## 3. Dispatch mechanics (closed)

### 3.1 Separation from Motor OS input

| Mode | Input path |
|------|------------|
| **VideoStreaming** | Existing OS/uinput and/or CDP **display** inject — unchanged. |
| **PageProjection** | **Isolated.** No `OsInputBackend`, no `/dev/uinput`, no X11 virtual devices. |

### 3.2 CDP-pure

1. Element intents: `speculum-anchor` → Element (pierce-aware).
2. Pointer motion: surface CSS coords → Virtual viewport CSS coords → CDP
   `Input.dispatchMouseEvent` / `dispatchTouchEvent`.
3. Prefer trusted CDP/Patchright over in-page `dispatchEvent` / `el.click()`.
4. In-page DOM only as last-resort fallback (logged).
5. Never map intents to OS EV_* streams.

### 3.3 Stealth within CDP

- Realistic **move path** before press (antibot).
- `mouseMoved` → `mousePressed` → `mouseReleased` as the primary click gesture.
- `element.click()` **only** as fallback if pressed/released failed, or for
  non-pointer activation (e.g. keyboard “activate”) — never in addition to a
  successful pressed/released for the same gesture (§6.5).
- Focus before key/text when relevant.
- Prefer `insertText` / CDP key over synth-only `KeyboardEvent`.
- No claim of uinput-level stealth.

---

## 4. Hard invariants

1. No site JS on Projected.
2. Element intents → `speculum-anchor`; motion → surface coordinates (§6.3).
3. CDP-only; no OS/uinput.
4. Structure/paint truth returns via F DomDiff.
5. Drop intents with stale `generation`.
6. Pierce-aware resolve for anchors; client does not run iframe/shadow JS.
7. **No double-fire** of the same physical gesture (§6.5).
8. **Inject chain** never reorders moves after their following down/up.
9. **Desync is client-only:** while PageProjection is desynced, the client
   **does not emit** intents. Virtual never needs a “client is desynced” signal.
   Recovery = client OOB `PageProjection.Resync` (not an input intent) — §9.1.

---

## 5. End-to-end flow

```
Projected → coalesce pointer / scrollViewport|scrollElement → PageProjectionIntent
        → data-plane → sidecar inject chain → CDP
        → site JS → F DomDiff → Projected
```

---

## 6. Intent model (wire)

### 6.1 DTO (V1)

Logical MessagePack / proto fields (camelCase on the wire):

```
PageProjectionIntent {              // rename from DomProjectionIntent at T11
  generation: u64
  type: string                 // see §6.2
  anchor: string | null        // required for element intents
  timestampClient: f64 | null  // performance.now() or epoch ms — pick one in impl, keep stable
  payload: PageProjectionIntentPayload
}

PageProjectionIntentPayload {
  // Pointer / wheel (CSS px in surface space — §6.3)
  x: f64 | null
  y: f64 | null
  button: i32 | null           // 0 left, 1 middle, 2 right; per UI Events
  buttons: i32 | null          // bitfield
  modifiers: {
    alt: bool
    ctrl: bool
    meta: bool
    shift: bool
  } | null
  pointerType: string | null   // "mouse" | "touch" | "pen"
  pointerId: i32 | null
  pressure: f64 | null
  deltaX: f64 | null           // wheel
  deltaY: f64 | null
  deltaMode: i32 | null

  // Keyboard
  key: string | null
  code: string | null
  repeat: bool | null
  location: i32 | null         // DOM key location

  // Input / select
  value: string | null
  checked: bool | null

  // File upload (§6.9)
  files: PageProjectionFileRef[] | null

  // Scroll fields are **type-exclusive** (§9) — not a free nullable bag:
  //   type=scrollViewport → scrollX, scrollY (anchor null)
  //   type=scrollElement  → scrollTop, scrollLeft (anchor required)
  // Other types must omit/null all four.
  scrollX: f64 | null
  scrollY: f64 | null
  scrollTop: f64 | null
  scrollLeft: f64 | null
}

PageProjectionFileRef {           // rename at T11
  uploadId: string | null      // from POST dom-uploads (preferred)
  name: string
  type: string                 // MIME
  lastModified: f64 | null
  size: u64
  bytes: bytes | null          // only if size ≤ fileUploadInlineMaxBytes
}
```

Unused fields are null/omitted. Evolve with schema version only if breaking.

### 6.2 Intent types (V1)

| Type | When emitted from Projected | Virtual CDP (primary) |
|------|----------------------------|------------------------|
| `mousemove` | coalesced move | `mouseMoved` |
| `mousedown` | button down | `mousePressed` |
| `mouseup` | button up | `mouseReleased` |
| `pointermove` / `pointerdown` / `pointerup` | when `pointerType` is touch/pen or touch-primary session | touch and/or mouse per §6.6 |
| `wheel` | wheel | mouse wheel |
| `auxclick` | non-primary button click (after down/up) | **do not** extra CDP click — down/up already sent; auxclick is optional signal only (default: **omit wire**, rely on down/up) |
| `contextmenu` | context menu gesture | **preventDefault** on Projected; ensure right-button down/up already remoted; no separate OS menu |
| `input` | input/change on non-file controls | focus + value / `insertText` |
| `setFiles` | user chose file(s) for `input[type=file]` (§6.9) | Playwright/CDP `setInputFiles` |
| `keydown` / `keyup` | keys | `dispatchKeyEvent` |
| `scrollViewport` | user scrolled the **page/viewport** | absolute viewport scroll via CDP-capable path |
| `scrollElement` | user scrolled an **overflow container** | absolute `scrollTop`/`scrollLeft` on anchored element |
| `focus` / `blur` | focus changes on anchored controls | CDP/Patchright focus/blur |

**No wire `click` intent in V1.** The browser `click` event on Projected is
`preventDefault`’d (as needed) and **not** forwarded. Activation on Virtual is
**only** `mousedown`+`mouseup` (and motion path) via CDP — avoids double-fire
with an extra `element.click()` / click event (§6.5).

**Out of V1 (explicit non-support):** IME `composition*`, HTML5 **OS drag-and-drop
onto arbitrary dropzones** (file **input** upload is in V1 — §6.9), exotic
multi-touch beyond §6.6.

### 6.3 Coordinate space (closed)

All pointer coordinates in payloads are **CSS pixels in surface space**:

1. Let `surface` be the projection host that displays the Projected document
   (same box used for viewport lockstep sizing).
2. `rect = surface.getBoundingClientRect()`.
3.  
   `x = (event.clientX - rect.left) * (viewportWidth / rect.width)`  
   `y = (event.clientY - rect.top) * (viewportHeight / rect.height)`  
   where `viewportWidth/Height` are the session Virtual viewport CSS sizes.
4. Clamp to `[0, viewportWidth]` × `[0, viewportHeight]` (or allow 1px edge
   slop — impl choice).
5. Speculum chrome **outside** `surface` does not generate projection intents.
6. Use **CSS pixels**, not device pixels. CDP mouse events use the Virtual
   layout viewport coordinate system matching these values under lockstep.
7. If `rect.width/height` is 0 (hidden), drop pointer intents.

Letterboxing / CSS scale on the surface is corrected by the
`viewportSize / rectSize` factors above.

### 6.4 Pointer coalesce & backpressure (closed)

**Client**

- Coalesce `mousemove` / `pointermove` to the **latest** sample per animation
  frame (default); alternate fixed window **8–16ms** if rAF unavailable.
- Before `mousedown` / `mouseup` / `pointerdown` / `pointerup` / `wheel`:
  **flush** any pending coalesced move immediately (path must end on press).
- Never await network on the UI thread.

**Sidecar inject chain**

- Strict serial execution: prior intent finishes (or fails) before next runs.
- **Hard rule under load:** never drop `mousedown`, `mouseup`, `pointerdown`,
  `pointerup`, `keydown`, `keyup`, `input`, `setFiles`, `focus`, `blur`,
  `input`, `setFiles`, `focus`, `blur`,
  `scrollViewport`, `scrollElement`, `wheel`.
- If chain depth or age exceeds limits: **collapse queued moves** to a single
  latest `mousemove`/`pointermove` (and latest scroll sample **per scroller**);
  emit metric /
  diagnostic. Do not stall presses behind a long move backlog — drop/coalesce
  moves first.

**Defaults (runtime-configurable under Sessions Dom Projection input — §11)**

| Knob | Default |
|------|---------|
| pointer coalesce | `raf` |
| pointerCoalesceMs | `8` (when not raf) |
| injectChainMaxDepth | `64` |
| injectMoveCollapseAgeMs | `50` |

### 6.5 No double-fire (closed)

| Projected browser event | Wire | Virtual |
|-------------------------|------|---------|
| `mousemove` / `pointermove` | yes (coalesced) | CDP move |
| `mousedown` / `pointerdown` | yes | CDP pressed / touch start |
| `mouseup` / `pointerup` | yes | CDP released / touch end |
| `click` | **no** | **no** extra click — derived from pressed+released |
| `auxclick` | no (V1) | covered by non-primary down/up |
| `contextmenu` | preventDefault; rely on right down/up | no synth menu |

`element.click()` on Virtual: **fallback only** after CDP pressed/released
failure for that gesture, or keyboard-driven activate without a pointer
gesture — never both successful pressed/released **and** `element.click()` for
the same user gesture.

### 6.6 Touch vs mouse (closed)

Follow the session **device profile** (same notion as video `touchPrimary`):

| Session | Pointer stream |
|---------|----------------|
| Desktop / mouse-primary | Mouse CDP (`mouseMoved` / pressed / released / wheel) |
| Mobile / touch-primary | Prefer CDP **touch** for `pointerType === "touch"`; map coalesced moves to touch move; mouse events from emulated desktop-on-mobile still allowed if the client sends them |

Do not open OS multitouch devices for Dom Projection.

### 6.7 Target resolution (LOCKED — anchor, not DomSelector)

**Intent addressing ≠ Dom-plane `DomSelector`.** Diffs use `DomSelector`
(`element` | `childAt`) for projected apply. Intents always target an
**element** (or the viewport) on Virtual via CDP — wire identity stays
**`speculum-anchor`** (+ surface coords for pointer). No `childAt` / text-node
locus on the input wire.

**Projected — element intents**

1. Walk from `event.target`.
2. For activate (down on actionable): prefer `button`, `a`, `[role="button"]`,
   `input`, `select`, `textarea`, `summary`.
3. **`input[type=file]` (and its `<label>`):** do **not** treat as normal
   pointer activate toward Virtual. Intercept → client native picker →
   `setFiles` (§6.9). Motion path may still be remoted for antibot; the file
   chooser itself stays client-side.
4. Require `speculum-anchor`.
5. Include `x`,`y` from §6.3 on pointer downs/ups even when anchor is set.

**Projected — motion**

Surface coords only; anchor under point optional (diagnostics).

**Projected — keyboard without focus**

1. If an anchored control is focused → that anchor.
2. Else last focused projection anchor in this generation.
3. Else CDP `dispatchKeyEvent` **page-targeted** (no anchor) — modifiers and
   key still sent so document-level shortcuts can run on Virtual.

**Virtual**

Pierce-aware anchor resolve. On miss → §8 race policy.

### 6.8 Right-click / context menu (closed)

- Remoted as `mousedown`/`mouseup` with `button: 2` (and motion path).
- Projected `contextmenu`: `preventDefault` so the Speculum shell menu does
  not steal; Virtual receives the right-button CDP sequence (site may open its
  own menu in the Virtual DOM, then F projects it).

### 6.9 File upload (`input type="file"`) — V1 (closed)

Native file picker runs on the **client** (user’s OS dialog). Speculum then
applies bytes to the Virtual file input with Playwright/CDP **`setInputFiles`**.
Still **no OS/uinput** and **no** server-side Chrome file dialog.

**Why not CDP-click the Virtual file input?** That would open a file chooser
**inside the session host** (useless for the user). Activate on
`input[type=file]` (and associated `<label>`) is intercepted on Projected:
local picker only, then `setFiles`.

**Flow**

```
User activates Projected file input / label
        │
        ▼
Client: stop Virtual-oriented activate for this control; open native picker
        (honor accept + multiple when possible)
        │
        ▼
For each File: if size ≤ inline cap → keep bytes for intent;
              else POST session dom-upload → uploadId
        │
        ▼
Intent type "setFiles" { anchor, files: [{ uploadId|bytes, name, type, … }] }
        │
        ▼
Sidecar: resolve anchor → setInputFiles(buffers) → input/change on page
        │
        ▼
Site JS runs; F projects DOM updates
```

**Upload API (bytes off the pointer pipe)**

```
POST /w7s/api/sessions/{sessionId}/dom-uploads?token=…
→ { uploadId }
```

Session auth same family as virtual-assets. Body: multipart or raw + filename /
content-type headers (impl choice).

**Limits (configurable §11)**

| Knob | Default |
|------|---------|
| `fileUploadMaxBytesPerFile` | `20971520` (20 MiB) |
| `fileUploadMaxFiles` | `20` |
| `fileUploadMaxTotalBytes` | `52428800` (50 MiB) |
| `fileUploadTtlSec` | `600` |
| `fileUploadInlineMaxBytes` | `262144` (256 KiB) |

Oversize → reject on client/API with clear error; no partial silent truncate.

**Dispatch**

- Materialize buffers from upload store and/or inline bytes.
- `setInputFiles` on the anchored element.
- If the page does not fire `input`/`change`, dispatch once as fallback (log
  `FallbackFileChange`).
- Delete upload blobs after success or TTL / session end.

**Security**

- Session-scoped; token/cookie required; not world-readable.
- Never put file bytes in DomDiff, journals, or diagnostic payloads.
- `setFiles` is never dropped by move-backpressure (§6.4).

**Not in this V1 slice**

- Drag-and-drop from OS onto arbitrary Projected drop zones (can reuse uploads +
  a future drop intent).
- `webkitdirectory` unless the same `setInputFiles` path proves trivial.

---

## 7. Bindings (Projected ↔ Virtual controls)

Aligned with F / Dom-plane D16 (`speculum-input-*` on patches):

| Attr | Meaning |
|------|---------|
| `speculum-input-value` | Upstream text |
| `speculum-input-checked` | Upstream checked |
| `speculum-option-selected` | Upstream selected |

### 7.1 Downstream (user → Virtual) — **immediate**

Local edit → emit `input` (or key) intent **immediately** — **no**
`inputBindingDebounceMs` on the send path. Mark the control **locally dirty**
so upstream patches know there is an in-flight edit conflict class.

### 7.2 Upstream (Virtual → Projected) — debounce **only** when dirty

- Control **not** dirty → apply F/`patch` attrs **immediately**.  
- Control **dirty** (user editing this control) → debounce
  (**default 1000ms**, `inputBindingDebounceMs` §11): keep latest upstream
  sample; on fire, if local ≠ upstream → overwrite (**Virtual wins**).  
- This debounce is **only** the “user is editing this control” conflict class
  (Dom-plane D16). It is **not** a global delay on every Dom `patch`.  
- Caret/selection: **not** synced in V1 (accept jump on force overwrite).

### 7.3 Checked / select

Same rules: intent send immediate; upstream debounce only while dirty.

---

## 8. DomDiff × intent race (closed)

When resolve(anchor) misses:

1. Retry resolve up to **3** times with short delay (**16ms** budget each,
   ~50ms total) — covers in-flight DomDiff apply replacing the node.
2. If still missing and `generation` matches: drop intent; emit diagnostic
   `anchorMiss`; do **not** invent a target.
3. Optional: after repeated misses (threshold impl-defined), client may enter
   **desync** and run OOB `PageProjection.Resync` — never storm; never a wire
   input intent named `resync`.

Stale `generation` → drop immediately (no retry).

---

## 9. Scroll & focus (closed — aligned with Dom-plane seal)

**Scroll (LOCKED — same split as PageProjection Dom diffs):**

Two intent types — **no** single `scroll` mega-payload with everything nullable
(already locked in Dom-plane scroll debate; this doc must match):

| Type | `anchor` | Payload (absolute) |
|------|----------|-------------------|
| `scrollViewport` | omitted | `{ scrollX, scrollY }` |
| `scrollElement` | **required** (scroll container) | `{ scrollTop, scrollLeft }` |

- Coalesce **per scroller** (one bucket for viewport; one per container anchor)
  → **last sample**.  
- Never drop scroll under inject-chain pressure (collapse to latest sample for
  that scroller only — §6.4).  
- F / Dom diffs do **not** carry scroll offsets; Virtual→client uses
  `scrollViewport` / `scrollElement` **diff** ops (Dom-plane seal).  
- Echo filter on Virtual for session-applied scrolls (Dom-plane seal).

**Focus / blur:** **in V1** for anchored controls (`input`, `textarea`, `select`,
`button`, `a`, `[contenteditable]`, `[tabindex]`). Local focus for a11y; wire
`focus`/`blur` so Virtual `activeElement` matches. Prefer CDP focus.

### 9.1 Desync / disarm (LOCKED — client-only)

Aligned with Dom-plane D12 + CSSOM C8:

1. PageProjection desync (sequence gap, selector/id miss on **diff apply**,
   overflow→desync, etc.) is detected and held **on the client**.  
2. While desynced: client **arms down** — **no** `PageProjectionIntent` is
   sent (pointer, scroll, key, input, setFiles, focus, …).  
3. **Virtual does not learn** that the client is desynced and does not need a
   special “disarm” signal — input simply stops arriving.  
4. Recovery: client OOB **`PageProjection.Resync`** (Dom `document` + CSSOM
   `install` + watermark). After apply + live drain, client **re-arms** and
   may emit intents again.  
5. There is **no** input intent type `resync`. That name is reserved for the
   OOB fetch only.

Anchor miss alone (§8) stays retry→drop unless the client chooses to escalate
to full desync after repeated misses.

---

## 10. Forms / submit (closed)

No dedicated `submit` intent in V1. Submit is **pointer or key activation** on
the submit control (down/up or Enter keydown) remoted normally; Virtual site JS
runs submit. Projected: `preventDefault` on form submit that would navigate the
Speculum shell.

---

## 11. Config (admin / runtime)

Sessions Dom Projection **input** section (names TBD in config model):

| Knob | Default | Runtime configurable |
|------|---------|----------------------|
| `pointerCoalesceMode` | `raf` | yes |
| `pointerCoalesceMs` | `8` | yes |
| `injectChainMaxDepth` | `64` | yes |
| `injectMoveCollapseAgeMs` | `50` | yes |
| `inputBindingDebounceMs` | `1000` | yes |
| `anchorMissRetries` | `3` | yes |
| `anchorMissRetryMs` | `16` | yes |
| `fileUploadMaxBytesPerFile` | `20971520` | yes |
| `fileUploadMaxFiles` | `20` | yes |
| `fileUploadMaxTotalBytes` | `52428800` | yes |
| `fileUploadTtlSec` | `600` | yes |
| `fileUploadInlineMaxBytes` | `262144` | yes |

Not every internal constant needs a knob — only the above.

---

## 12. Pipeline ownership

| Step | Owner |
|------|--------|
| Listeners, coord transform §6.3, coalesce, no-wire-click | Client |
| `PageProjectionIntent` | Client |
| Transport | Sessions data-plane |
| Admit, inject chain, backpressure collapse, CDP dispatch | Sidecar PageProjection input (**not** `OsInputBackend`) |
| DomDiff | F |

---

## 13. Failure, ordering, diagnostics

| Case | Behavior |
|------|----------|
| Stale generation | Drop |
| Anchor miss | §8 retry then drop + `anchorMiss` |
| CDP/dispatch error | Log/diagnose; continue session |
| Ordering | Single inject chain FIFO; moves collapsed under pressure only as §6.4 |

**Diagnostics (catalog — implement with `errorCode` + `phase`):**

| Signal | When |
|--------|------|
| `PageProjection.Input.AnchorMiss` | resolve failed after retries |
| `PageProjection.Input.DispatchFailed` | CDP/Patchright threw / timeout |
| `PageProjection.Input.StaleGeneration` | dropped stale intent |
| `PageProjection.Input.MoveCollapsed` | backpressure collapsed moves |
| `PageProjection.Input.FallbackElementClick` | used `element.click()` fallback |
| `PageProjection.Input.FileUploadRejected` | oversize / count / auth |
| `PageProjection.Input.SetFilesFailed` | setInputFiles / missing uploadId |
| `PageProjection.Input.FallbackFileChange` | synth input/change after setFiles |
| `PageProjection.Input.Disarmed` | intent suppressed while client desynced (optional) |

(Catalog prefix today: `Telemetry.Sessions.DomProjection.Input.*` → rename at T11.)

Exact catalog registration follows Sessions Diagnostics standards.

---

## 14. Hit-test Projected ≠ Virtual (closed mitigation)

Cannot fully eliminate (e.g. CSS still loading). V1 mitigations:

1. Viewport lockstep + §6.3 coord mapping.
2. Prefer **anchor from element under point** at event time for downs (not only
   coords) when an anchored node is hit.
3. Do not send pointer intents until the client has applied at least one DomDiff
   with `target=document` for the current `generation` (surface “armed”).
4. Accept residual mismatch as non-support edge; metric if activate anchor ≠
   topmost painted target heuristics (optional later).

---

## 15. IME / composition (non-support)

V1: **no** `compositionstart` / `compositionupdate` / `compositionend` pipe.
Latin/`insertText` and CDP key cover many cases; CJK/IME-heavy flows may be
wrong — document in product support matrix as limitation until a later design.

---

## 16. Non-goals (V1)

- Site JS on Projected
- Pixel-perfect caret
- MSE/DRM beyond placeholder + normal pointer
- OS/uinput / video input pipeline
- Wire `click` intent / dual click+pressed delivery
- Full IME composition (§15)
- OS drag-and-drop onto arbitrary dropzones (file **input** is in V1 — §6.9)
- Perfect every PointerEvent field

---

## 17. Closed decisions (this pass)

| Topic | Decision |
|-------|----------|
| OS vs CDP | Dom Projection CDP-only; Motor OS untouched |
| Motion | mousemove/pointer/wheel in V1; coalesced; path before press |
| Coordinates | Surface CSS px → viewport CSS px (§6.3) |
| Double-fire | No wire `click`; CDP pressed+released only; element.click fallback only (§6.5) |
| Touch | Device profile / pointerType (§6.6) |
| Context menu | preventDefault + right button down/up |
| Key without focus | Last anchor → else page-level CDP key |
| Race | Retry resolve then drop (§8) |
| Backpressure | Collapse moves only; never drop presses/keys/input/setFiles (§6.4) |
| DTO | §6.1 (+ file refs) |
| Focus/blur | In V1 for anchored controls |
| **Desync/disarm** | Client-only; no intents while desynced; recovery = OOB `PageProjection.Resync`; **no** input `resync` type; Virtual unaware |
| **Rename** | E2E with mode/pipe: Intent/FileRef/telemetry/APIs → `PageProjection*` (T11) |
| **Scroll** | **`scrollViewport` + `scrollElement`** — absolute; per-scroller coalesce; mirrors Dom-plane diff ops; **no** single nullable `scroll` mega-payload |
| **Intent address** | `speculum-anchor` (+ coords); **not** `DomSelector` (diff-only) |
| Submit | No separate intent |
| Binding debounce | **Upstream-only** while dirty (default 1s); **never** delays intent send |
| **File upload** | Client picker → dom-uploads / inline → `setFiles` + `setInputFiles` (§6.9) |
| IME | Non-support V1 |
| Hit-test | Mitigations §14; residual accepted |
| Diagnostics | Named signals §13 |

---

## 18. Explicitly later

| Item | Notes |
|------|-------|
| IME composition pipe | Dedicated design |
| OS drag-and-drop dropzones | Reuse dom-uploads + drop intent |
| `webkitdirectory` | If needed beyond normal setFiles |
| Admin UI polish for §11 knobs | After config wiring |
| Stronger hit-test verification metrics | Optional |

---

## 19. Spike vs this design

| Spike | Target |
|-------|--------|
| Numeric ids | `speculum-anchor` + surface coords |
| Click without path / possible double paths | Coalesced moves + pressed/released; **no wire click** |
| No backpressure policy | Move collapse under chain pressure |
| Ad-hoc JSON | Structured DTO §6.1 |
| Coupled to OS risk | Isolated CDP path |

Implementation follows this contract. Changes update §§3–8 and §17 first.

---

## 20. PageProjection alignment checklist (pre-cutover)

| # | Topic | State |
|---|--------|--------|
| I1 | Scroll intents = `scrollViewport` \| `scrollElement` (no mega `scroll`) | **LOCKED** (§9) |
| I2 | Desync disarm client-only; no input `resync`; OOB Resync | **LOCKED** (§9.1) |
| I3 | E2E rename includes input (`PageProjectionIntent`, …) | **LOCKED** (banner + §17) |
| I4 | D16 form: intent immediate; debounce only conflicting upstream patch | **LOCKED** (§7) |
| I5 | Addressing = `speculum-anchor` (+ coords); not `DomSelector` | **LOCKED** (§6.7) |

**Input pipeline aligned with PageProjection seal.** Remaining work = T11
cutover (rename + implement), not further input-behaviour debate.


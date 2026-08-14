# Implementation — `surface.tsx` (web)

**Future path:** `Refactor/web/src/features/sessions/live/page/surface.tsx`  
**LOC ceiling:** 350  
**Contracts:** [08-surface.md](../../contracts/08-surface.md), [05-establish.md](../../contracts/05-establish.md), [07-recovery.md](../../contracts/07-recovery.md)  
**Norm:** redesign §5.8  
**UI standards:** shadcn-only chrome outside the iframe; the iframe document itself is the Projected site surface (not a stand-in div).

---

## Purpose

Host the Projected document: same-origin sandboxed iframe **without** `allow-scripts` (K5 browser-enforced), viewport lockstep with Virtual, **double buffer** for hard navigation / resync (P6), arming gate, and progressive establish HTML writes into the active buffer’s parser.

Orchestration of decode/apply remains in `ProjectionClient`; this module owns DOM host lifecycle, swap, and loading affordance.

---

## Invariants

1. `sandbox` attribute MUST NOT include `allow-scripts` (PP-SURF-3). Same-origin so parent can access `contentDocument` for apply (use `sandbox="allow-same-origin"` only, or the minimal set that preserves same-origin **without** scripts — **never** `allow-scripts`).
2. Iframe CSS viewport size = Virtual viewport CSS px (width/height on iframe / layout box).
3. Stable client screen ⇒ zero Virtual `Resize` (MATRIX D6); zoom/DPR change ⇒ Resize lockstep (PP-SURF-5).
4. Double buffer on Document swap or resync: build in second iframe; swap at first-meaningful-paint threshold or `swapTimeoutMs` (1500).
5. Retiring a buffer destroys its registry, owned CSSOM, id map (PP-NAV-3).
6. Soft navigation: no second buffer, no generation bump, no re-establish (PP-NAV-2) — live frames only.
7. No CSS text rewriting anywhere (PP-SURF-4).
8. Input events captured inside iframe document; content box is the surface rect.

---

## Bans

- Stand-in `div` as document root.
- `allow-scripts`.
- Regex `html`/`body` selector rewriting / rem→px / vw→cqw hacks.
- Independent projected zoom without Virtual viewport update.
- Blanking the visible iframe before the swap threshold on hard nav (P6 / PP-NAV-1).
- Arming before establishEnd + registry verify + cssomInstall.

---

## Types and signatures

```ts
export type SurfacePhase =
  | 'empty'
  | 'establishing'
  | 'armed'
  | 'desynced'
  | 'swapping';

export type BufferId = 'a' | 'b';

export type SurfaceBuffer = {
  id: BufferId;
  iframe: HTMLIFrameElement;
  document: Document;           // contentDocument after open
  registry: Registry;
  cssom: CssomRegistry;
  generation: number | null;
};

export type SwapThreshold = {
  establishEndApplied: boolean;
  cssomInstallApplied: boolean;
  bodyHasLayoutBox: boolean;    // non-empty layout box — measured OUTSIDE apply write batch
  timedOut: boolean;            // swapTimeoutMs after establishEnd∧cssomReady
};

export type SurfaceProps = {
  virtualViewportCssPx: { w: number; h: number };
  swapTimeoutMs: number;        // default 1500 from config
  onArmedChange?: (armed: boolean) => void;
  onSurfaceRect?: (rect: DOMRectReadOnly) => void;
  /** Loading affordance while !armed */
  showLoading: boolean;
};

export type SurfaceHandle = {
  getActive(): SurfaceBuffer;
  getBuilding(): SurfaceBuffer | null;
  /** Begin establish/resync into building buffer (or active if cold empty). */
  beginEpoch(generation: number, opts: { resync: boolean }): SurfaceBuffer;
  writeEstablishChunk(bytes: Uint8Array | string): void;
  markCssomInstallApplied(): void;
  markEstablishEndApplied(): void;
  /** Evaluate swap threshold; may promote building → active. */
  maybeSwap(): boolean;
  setArmed(armed: boolean): void;
  isArmed(): boolean;
  setPhase(phase: SurfacePhase): void;
  retire(buffer: SurfaceBuffer): void;
  setViewportCssPx(w: number, h: number): void;
  /** Open document for streaming parse if needed. */
  ensureParserOpen(buffer: SurfaceBuffer): void;
};
```

---

## Algorithm — iframe creation

```
createIframe():
  iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-same-origin')  // NO allow-scripts
  iframe.setAttribute('title', 'Projected session')    // a11y
  apply size: width/height style = virtualViewportCssPx
  // same-origin: about:blank then contentDocument.open() for establish stream
```

Parent React tree hosts one or two iframes stacked; only active is visible (`visibility`/`z-index`); building may be `visibility:hidden` but still laid out at full size so layout box / media queries match (PP-SURF-1).

---

## Algorithm — progressive establish write (PP-EST-1)

```
ensureParserOpen(buffer):
  doc = buffer.iframe.contentDocument
  if not open:
    doc.open()
    // optional doctype write once

writeEstablishChunk(bytes):
  doc.write(utf8decode(bytes))   // progressive; paints natively
  // MUST NOT doc.close() until establishEnd (or explicit end)

onEstablishEnd:
  doc.close() if still open
  registry.buildFromDocument(doc) + verify (caller)
```

`cssomInstall` applied **before** first `write` of body-affecting HTML (PP-EST-6). Head/CSS install order is producer-defined; surface MUST allow install into buffer document before chunks.

---

## Algorithm — double buffer + swap (P6, PP-NAV-1)

```
beginEpoch(generation, { resync }):
  if active is empty/uninitialized and !resync:
    building = active  // cold path: single buffer
  else:
    building = create second buffer (other of a|b)
    copy viewport size
  building.generation = generation
  clear registries on building
  phase = 'swapping' or 'establishing'
  return building

Swap threshold (first-meaningful-paint):
  ready = establishEndApplied ∧ cssomInstallApplied ∧ bodyHasLayoutBox
  OR (establishEndApplied ∧ cssomInstallApplied ∧ elapsed >= swapTimeoutMs)

bodyHasLayoutBox:
  // Read layout AFTER write batch / in rAF after establishEnd
  body = building.document.body
  box = body.getBoundingClientRect()  // allowed here — not during applyDom write batch
  non-empty = box.width > 0 && box.height > 0

maybeSwap():
  if !building || !threshold → false
  show building; hide old active
  retire(old active)  // PP-NAV-3
  active = building; building = null
  return true
```

Hard navigation: Virtual generation bump → client `beginEpoch` → keep old visible until swap → no blank frame.

Resync: same double-buffer path with resync flag (contract 07).

---

## Algorithm — arming

```
Arm only when:
  establishEnd applied
  ∧ registry verified (nodeCount + checksum)
  ∧ cssomInstall applied
  ∧ (after hard-nav) swap completed OR cold single-buffer ready

setArmed(true) → onArmedChange(true); phase='armed'
Before arm: showLoading; interaction MUST NOT send pointer intents (PP-EST-5)
Desync: setArmed(false); phase='desynced'
```

---

## Algorithm — viewport + DPR (PP-SURF-5)

```
setViewportCssPx(w,h):
  style both iframes to w×h CSS px

On visualViewport resize / devicePixelRatio change in shell:
  notify session to send Virtual Resize (existing device profile path)
  update iframe CSS size to match new Virtual viewport when ack’d
Forbidden: CSS zoom on iframe content independent of Virtual
```

DPR at session start is device-profile (not this file’s wire); surface consumes viewport props.

---

## Algorithm — retire (PP-NAV-3)

```
retire(buffer):
  buffer.registry.clear()
  buffer.cssom.clear()
  buffer.iframe.remove() / src=about:blank
  drop references so GC collects document
```

---

## Soft navigation (PP-NAV-2)

No `beginEpoch`. Live `childList`/`patch`/`documentState` against active buffer only. Generation unchanged.

---

## Tests

| ID | Assert |
|----|--------|
| `PP-SURF-1` | Media query match Virtual vs Projected same viewport |
| `PP-SURF-2` | `position:fixed` stays fixed on scroll |
| `PP-SURF-3` | Injected `<script>` in payload does not execute |
| `PP-SURF-4` | No CSS text rewrite utilities imported/called |
| `PP-SURF-5` | Zoom/DPR → Virtual Resize; stable screen → 0 Resize |
| `PP-NAV-1` | Hard nav: old doc visible until new paints; no blank frame |
| `PP-NAV-2` | Soft nav: no generation bump / no re-establish |
| `PP-NAV-3` | Retired buffer registries released (leak hunter) |
| `PP-EST-1` | Paint before stream completes |
| `PP-EST-5` | Unarmed: loading affordance; no silent mis-target |
| `PP-EST-6` | cssomInstall before first chunk write |

# WP15 — CDP spike (`DOMSnapshot.captureSnapshot`)

**Status: REJECT for now.** Not adopted. `identity.ts` keeps the in-page `WeakMap` + reverse-map
scheme (§5.1) as the default and only implementation. This file is the evidence record required
before WP15 can be revisited; it does not commit to anything.

Canon: [`docs/page-projection/spec/README.md`](../../../../../../docs/page-projection/spec/README.md) (V4). Historical engine-redesign: archive.
§10 (WP15) and §12 (Q-series decisions). Per the redesign, WP15 is **"a spike, not a commitment"** —
relocating work does not by itself reduce host CPU; at 100 concurrent sessions the total host cost is
what binds, so a change is only worth adopting if it *reduces total work*, not merely moves it off the
main thread.

## What was proposed

`DOMSnapshot.captureSnapshot` returns the flattened render tree from the browser process in columnar
form — already close to the shape §5.5's binary wire wants — with `backendNodeId` as a browser-side
stable identity that could serve as the id in §5.1 with zero in-page allocation.

## Why it is rejected until evidence, not on principle

The redesign requires three things verified **before** adoption, none of which have been measured yet:

1. **Closed shadow root coverage.** `DOMSnapshot` traverses through `DOM.enable` node tracking; closed
   shadow roots and cross-origin iframes are exactly the content `fmap.ts`/`observe.ts` already pierce
   via in-page traversal (`PP-F-4`). Unverified whether the CDP snapshot sees the same content, or
   silently drops it — a silent drop would be a parity regression, not a performance win.
2. **Cost of `DOM.enable` with node tracking.** `DOM.enable` is known to be expensive at scale on
   real Chromium (extra IPC per mutation, retained shadow tree bookkeeping in the browser process).
   No host-CPU-at-100-sessions measurement exists. Given the "total work" caution above, this must be
   measured against the current in-page `MutationObserver` cost before any claim of a win is credible.
3. **§5.2.1 node-state sensors are not CDP-observable.** Dialog/popover top-layer state, media
   playback state, and `:invalid`/custom-validity state (`PP-D16-1..4`) are not part of the DOM domain.
   Even a full CDP adoption still needs in-page sensors for these — so CDP would not eliminate the
   in-page instrumentation surface, only partially overlap it.

## Secondary consideration

Heavier in-page CDP wiring (`DOM.enable`, retained backend node ids) is plausibly **more** detectable
by antibot heuristics than the current in-page `MutationObserver` + `WeakMap` approach, which looks
like ordinary page script. This cuts against adoption on the K2/stealth axis as well as the K4 parity
axis — a detected session is not a 1:1-parity session.

## Evidence checklist before WP15 can be reopened

- [ ] Live-measured `DOM.enable` + snapshot cost at 1, 10, 100 concurrent sessions (host CPU, RSS) vs.
      the current `MutationObserver` baseline from O4 (`PP-DEN-1`, `PP-DEN-2`)
- [ ] Closed shadow root + cross-origin iframe coverage confirmed equal to current `fmap.ts`/`observe.ts`
      pierce behaviour (`PP-F-4`) on the baseline site set
- [ ] Confirmed plan for §5.2.1 sensors (dialog/popover/media/validity) that CDP does not cover —
      either "still in-page, CDP only replaces identity/tree" or a concrete CDP-only alternative
- [ ] Antibot detectability delta measured against `docs/stealth-suite.md` baselines, not assumed
- [ ] Net host-work delta computed as *total*, not *relocated* (per the redesign's caution)

## Decision

**REJECT for now.** Default and only path: in-page `WeakMap` identity (`identity.ts`, §5.1). Revisit
only with the checklist above satisfied by live measurement, not analysis.

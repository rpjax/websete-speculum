<!-- reconciled-2026-08-14; item 5 swap-trigger wording updated 2026-08-14 (Stage 4) -->
> **PARTIALLY SUPERSEDED.** The double-buffer surface mechanism here is still correct and is
> reused as-is by [`frame-protocol.md`](../frame-protocol.md) §5.8. **Only the swap-trigger
> condition changes:** replace `establishEnd ∧ cssomInstall ∧ body non-empty` (item 5 below) with
> *"the resync frame's closing whole-table `CHECK` verifies OK"* (§5.8, "Client side"). Establish
> (§4.7) no longer exists. See [`../RECONCILIATION.md`](../RECONCILIATION.md).
>
> Implemented (lab tree only, frame-protocol-production-completeness Stage 4 — hub/gRPC production
> wiring is a separately-deferred milestone, `frame-protocol.md` decision log 2026-08-14): real
> second iframe (`client/surface.ts`'s `beginResyncBuild`/`commitSwap`/`discardBuild`), own
> `ReplicatedTable`/registry, swap gated purely on phase 1 + phase 2 completing for the resync
> frame (`DomFrameApplier`'s `onApplied`, which only ever fires after its closing `CHECK` already
> verified in phase 1) — no `swapTimeoutMs` fallback (item 5's old timeout escape hatch does not
> exist for this trigger: a resync frame's `CHECK` failing is a defect, not a slow-paint condition
> to time out past, `frame-protocol.md` §5.8 "A resync frame whose closing CHECK fails...").

# Contract 08 — Surface

**Norm:** redesign §5.8. **Tests:** PP-SURF-1..5, PP-NAV-1..3. **Impl:** `surface.md`.

## Host document

1. Same-origin iframe; `sandbox` **without** `allow-scripts` (K5 browser-enforced) — PP-SURF-3.  
2. Native `rem`/`vw`/`vh`/`%`/`:root`/`html`/`body`/overflow/media queries/`position:fixed`/top layer/scrollbars — PP-SURF-1, PP-SURF-2.  
3. **All CSS text rewriting deleted** — PP-SURF-4.  
4. Iframe CSS viewport = Virtual viewport CSS px. Stable screen ⇒ zero `Resize` (MATRIX D6).  
5. **Double buffer (P6):** on Document swap or resync, build in second iframe; swap when **the resync frame's closing whole-table `CHECK` verifies OK** (`frame-protocol.md` §5.8 "Client side" — supersedes the old `establishEnd ∧ cssomInstall ∧ body non-empty`, `establishEnd` no longer exists; no `swapTimeoutMs` fallback, a `CHECK` failure is a defect, not a slow-paint condition) — PP-NAV-1. Retire buffer destroys registry, owned CSSOM, id map — PP-NAV-3.  
6. DPR at session start in device profile. Client zoom/DPR ⇒ Virtual `Resize` lockstep. Independent projected zoom **forbidden** — PP-SURF-5.  
7. Input coords: iframe content box; events captured inside iframe document.

## Soft navigation

No generation bump; no re-establish — PP-NAV-2.

## MUST NOT

- Stand-in `div` as document root.  
- `allow-scripts`.  
- Regex `html`/`body` selector rewrites.

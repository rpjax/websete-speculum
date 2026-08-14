# Contract 08 — Surface

**Norm:** redesign §5.8. **Tests:** PP-SURF-1..5, PP-NAV-1..3. **Impl:** `surface.md`.

## Host document

1. Same-origin iframe; `sandbox` **without** `allow-scripts` (K5 browser-enforced) — PP-SURF-3.  
2. Native `rem`/`vw`/`vh`/`%`/`:root`/`html`/`body`/overflow/media queries/`position:fixed`/top layer/scrollbars — PP-SURF-1, PP-SURF-2.  
3. **All CSS text rewriting deleted** — PP-SURF-4.  
4. Iframe CSS viewport = Virtual viewport CSS px. Stable screen ⇒ zero `Resize` (MATRIX D6).  
5. **Double buffer (P6):** on Document swap or resync, build in second iframe; swap at first-meaningful-paint: `establishEnd` ∧ `cssomInstall` ∧ body non-empty layout box, **or** `swapTimeoutMs` (1500) after establishEnd+cssomReady — PP-NAV-1. Retire buffer destroys registry, owned CSSOM, id map — PP-NAV-3.  
6. DPR at session start in device profile. Client zoom/DPR ⇒ Virtual `Resize` lockstep. Independent projected zoom **forbidden** — PP-SURF-5.  
7. Input coords: iframe content box; events captured inside iframe document.

## Soft navigation

No generation bump; no re-establish — PP-NAV-2.

## MUST NOT

- Stand-in `div` as document root.  
- `allow-scripts`.  
- Regex `html`/`body` selector rewrites.

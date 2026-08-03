## Stealth suite results

- When (UTC): 2026-08-03 ~11:05 (WebGL VENDOR/RENDERER + UNMASKED; like-headless diagnose-only)
- Env: **dev** (`http://127.0.0.1:8080/w7s`)
- Sidecar: `speculum-refactor/speculum-refactor-sidecar:dev`
- Policy: browser-wide kit; suite = measure only
- Raw: [`stealth-suite-raw.json`](stealth-suite-raw.json)

### Delta — WebGL (P1)

| Signal | Before | After |
|--------|--------|-------|
| Harness `VENDOR` / `RENDERER` | WebKit / WebKit WebGL (often) or leak | **WebKit / WebKit WebGL** (forced kit) |
| Harness UNMASKED pc | Intel Mesa UHD | unchanged kit |
| Harness UNMASKED phone | Adreno | unchanged kit |
| `Mesa/X.org` in harness | yes (prior noise) | **gone** |
| Creep GPU lines | Mesa/X.org + kit UNMASKED | **still** Mesa/X.org **llvmpipe** *and* kit UNMASKED |

### Snapshot

| Axis | Desktop | Phone |
|------|---------|-------|
| Main WebGL (harness) | WebKit + Intel UNMASKED | WebKit + Adreno UNMASKED |
| Worker HW | cores 8 | cores 8 |
| Creep like-headless / stealth | 44% / 20% | 44% / 20% |

Illustrative score: **~76–78** (main WebGL story clean; Creep dual-GPU residual + 44% band remain).

---

### Like-headless diagnose (P2 — no fixes this wave)

Creep still **44% like headless / 20% stealth / 0% headless**. Closing main WebGL + Worker cores did **not** move the band.

**What still shows (ordered hypotheses for a later fix leva):**

1. **Dual GPU string in Creep** — harness is kit-clean; Creep still prints `Google Inc. (Mesa/X.org)` + `llvmpipe`. Likely WebGL (or GPU read) in a **non-main** realm (worker / OffscreenCanvas) or a path that bypasses prototype `getParameter`. Highest-confidence leftover GPU tell.
2. **Like-headless composite** — not explained by cores-22 anymore (already fixed). Candidates: software GL/llvmpipe tell, X11/container traits, canvas, prototype smell — **unproven**; need targeted attribute next wave, not flags.
3. **Network / TZ / TLS** — out of browser; unchanged.

**Next step (not this wave):** attribute where Creep reads Mesa/llvmpipe (worker WebGL vs other); only then extend the **same** getParameter kit story to that realm — still browser-wide, no site hacks.

---

### Explicitly not shipped

- Like-headless mitigations, Chrome “stealth” flags, `toString` hygiene, CDP WebGL inject, Windows kit.

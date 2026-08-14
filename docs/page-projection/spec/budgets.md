# PageProjection — constraints and budgets (V4)

**Status:** normative. Extracted from the pre-V4 engine-redesign so agents do not have to read a superseded 1000-line file.  
**Parent:** [frame-protocol.md](frame-protocol.md) does not restate these numbers.  
**Provenance:** archive `engine-redesign.md` §1–§2 (2026-08-11). Functional ≠ Perf: capacity/SLO still belongs in `perf.yml`; these budgets are still the product contract for M3.

V4 mapping notes are marked **(V4)**. Do not revive “establish HTML” because E2’s old name said “Establish wall.”

---

## 1. Constraints (given — not open for debate)

| # | Constraint |
|---|------------|
| **K1** | **No pixel/video streaming in PageProjection, ever** — not partial, not per-element. Screencast belongs exclusively to `MirrorMode.VideoStreaming`. |
| **K2** | **Session state is never shared.** Cookies, storage, credentials, identity, DOM, CSSOM, the id space, and any response fetched with credentials are strictly per session. **Exception:** immutable, credential-less **public byte content** may be deduplicated in a shared asset tier. Shared CSSOM, shared rewrite memo and shared id space remain rejected. |
| **K3** | **≥100 concurrent sessions** on an appropriately provisioned VPS, **with no degradation**. |
| **K4** | **Absolute 1:1 parity**, visual and interactive, per [acceptance.md](acceptance.md). |
| **K5** | **Site JavaScript executes only in the Virtual Chromium.** No page JS on the Projected surface, in any form. |

**Media (so K1 is not misread):** `<video>`/`<audio>`/HLS/DASH are served as **bytes** through the virtual-assets plane and played by the **client’s own** media engine. That is asset serving, not pixel streaming.

---

## 2. Parity budgets (Projected minus Virtual, same session)

| # | Budget | Target |
|---|--------|--------|
| **P1** | Δ First contentful paint (Projected FCP − Virtual FCP) | p50 ≤ **100 ms**, p95 ≤ **200 ms** |
| **P2** | Δ Fully materialized (Projected complete − Virtual `load`) | p95 ≤ **300 ms** |
| **P3** | Live lag: Virtual mutation → painted on Projected | p50 ≤ **RTT + 20 ms**, p95 ≤ **RTT + 50 ms** |
| **P4** | Input → **local** visual feedback | ≤ **16 ms**, never network-bound |
| **P5** | Input → **authoritative** effect on the Projected surface | ≤ **RTT + 50 ms** |
| **P6** | Hard navigation: Projected document swap after Virtual FCP | ≤ **150 ms**, with **no blank frame** |
| **P7** | Visual diff Virtual vs Projected at settle | ≤ **0.5%** differing pixels **and** zero structural regions ([oracles.md](oracles.md) O1) |

**(V4)** P6 is the double-buffer swap after `EPOCH_RESET` + first resync frame of the new generation (`CHECK` OK), not `establishEnd`.

---

## 3. Engine budgets

| # | Budget | Target | **(V4) meaning** |
|---|--------|--------|------------------|
| **E1** | Projection CPU per page load | ≤ **10%** of that page's own CPU, and ≤ **200 ms** absolute at 20k nodes | Unchanged |
| **E2** | First usable surface, cold, 20k nodes | ≤ **150 ms** | **Cold `resyncVirtual` + `emitResyncFrame` + client apply**, not HTML establish. No separate E-number yet for mid-session `resyncVirtual` walk at `MAX_ROWS` — see [open.md](open.md) residual (3) |
| **E3** | Producer CPU per live operation | ≤ **10 µs** | Per opcode / per coalesced batch, not per MutationRecord |
| **E4** | Client CPU per live operation | ≤ **10 µs** | Phase 1+2 per op |
| **E5** | Per-frame pipeline overhead (encode + wire) | ≤ **100 µs** | One frame per tick, not per mutation |
| **E6** | Steady-state CPU per session, continuously mutating page | ≤ **0.3%** of a core | Lab evidence (2026-08-13) is well under this on real sites; adversarial prepend-stress is the ceiling test |
| **E7** | Speculum-side memory per session (excludes Chromium) | ≤ **16 MB** | Includes replicated table |
| **E7b** | Host-wide shared asset tier (L2) | default cap **1 GiB**, LRU | Unchanged; not in the lab tree |
| **E8** | Journal facts per page load per session, default telemetry | ≤ **50** | Capability-toggle telemetry, not per-op Journal |
| **E9** | Client frame apply | ≤ **4 ms**, `requestAnimationFrame`-aligned | `applyOverrun` already emitted in lab client |
| **E10** | Session start: Chromium boot on the user's critical path | ≤ **50 ms** | Pool; production path |
| **E11** | Density | **design for 150** sessions, **gate at 100**, with P1–P7 held | M3 / `PP-DEN-1` |

Calibration of E6, E7b, E11 MUST be re-derived from oracle **O4** once it exists. Use these values until then.

---

## 4. Hard bans that look like budget work

Do not raise knobs, skip `CHECK`, or add a second path to “make E2 green.” That is an [acceptance.md](acceptance.md) defect. Fix the algorithm ([roadmap.md](roadmap.md) item 1 / OPEN-7 is the current table bug).

# PageProjection — oracles (V4)

**Status:** normative. Provenance: archive `engine-redesign.md` §7.  
**Accept still wins:** an oracle green with an unusable surface is a harness bug ([acceptance.md](acceptance.md)).

The old engine degenerated because the only automated verdict measured the **pipe**. V4 lab has structural diff + frame invariant monitor + CPU profile; O1/O4/O5 on baseline sites are still M3.

**How O2 is taken:** [observability.md](observability.md) §5 — `takeRecords` then drain/emit S then table×DOM in one in-page turn. Split evaluates are torn reads. A turn **without** `takeRecords` is snapshot lag (live DOM ahead of undelivered MO records) and MUST NOT be dismissed as “torn read.” CLI `--iso` runs Virtual O2 **and** table×table against Node `applyFrameToTableChecked` in the CLI process (not a second Chromium, not Projected). Tree×tree stays `skipped` on CLI (DOM apply is the 4077 UI). O1/O4/O5 are unimplemented.

**Halt O2/tree green does not prove PP-FR-1.** Same-tick create+destroy can ride the wire and paint on Projected, then vanish before the halt snapshot. That class: [observability.md](observability.md) §8.

| # | Oracle | Definition | V4 lab today |
|---|--------|------------|--------------|
| **O1** | **Visual diff** | Screenshot Virtual and Projected at the same viewport and settle points; assert **P7**. A connected differing region ≥ **2%** of the viewport, or any region where one side has rendered text and the other does not, is a **structural region** and fails regardless of global pixel %. | Not implemented (topology-only `structuralDiff.ts` is **not** O1) |
| **O2** | **Structural self-check** | Compare Virtual live DOM against the client tree; MUST be isomorphic after settle. Full comparison is CI/debug/lab only (O(n) — would violate E1 in production). Production cheap variant: node count + tableHash vs client-reported hash. | Coherent probe: **bus RPC `snapshot` per `contextId`** (OPEN-6) + lab `requestSnapshot(contextId)` apply snapshot at S **for that scope**. Local table×DOM inside that turn. CLI table×table = Node phase-1 apply in the caller. Tree×tree via `structuralDiff.ts` when a DOM apply exists (UI). **Tree×tree comparison boundary** (lab oracle, not product): peel already-rewritten `/w7s/virtual-*` (incl. absolute Projected-origin forms) before rewrite; Projected head shell nodes excluded **after** fingerprint align by structural shape (leaf/compact under `html>head`) — no tag/site allowlist; omit `style` on `html`/`body` (Projected surface chrome). Tree iso does **not** cover form `.value` / `.checked` / `.selected` — that is **PP-PROP-1** ([observability.md](observability.md)). `FrameInvariantMonitor` stays **wire-only** (one monitor per `contextId` in lab). |
| **O3** | **Budget gate** | [budgets.md](budgets.md) in CI. Exceeding P1–P7 or E1–E11 fails the build. | Lab telemetry percentiles exist; not wired as CI O3 |
| **O4** | **Density harness** | N concurrent sessions; per-session P1–P6 + host CPU/memory; find the **knee**. K3 cannot be claimed without it. | Not run (`PP-DEN-1` unrun) |
| **O5** | **Interaction latency probe** | Click / type / scroll: local feedback (P4) and authoritative effect (P5), including with network stalled. | Not in lab tree (input plane not cut over) |

O1, O2 and O5 MUST eventually run against at least `www.belezanaweb.com.br`, an Eneba soft-nav flow, and a live-odds page ([roadmap.md](roadmap.md) M3).

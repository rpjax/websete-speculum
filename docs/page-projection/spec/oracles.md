# PageProjection — oracles (V4)

**Status:** normative. Provenance: archive `engine-redesign.md` §7.  
**Accept still wins:** an oracle green with an unusable surface is a harness bug ([acceptance.md](acceptance.md)).

The old engine degenerated because the only automated verdict measured the **pipe**. V4 lab already has structural diff + frame invariant monitor + CPU profile; O1/O4/O5 on baseline sites are still M3.

| # | Oracle | Definition | V4 lab today |
|---|--------|------------|--------------|
| **O1** | **Visual diff** | Screenshot Virtual and Projected at the same viewport and settle points; assert **P7**. A connected differing region ≥ **2%** of the viewport, or any region where one side has rendered text and the other does not, is a **structural region** and fails regardless of global pixel %. | Not implemented (topology-only `structuralDiff.ts` is **not** O1) |
| **O2** | **Structural self-check** | Compare Virtual live DOM against the client tree; MUST be isomorphic after settle. Full comparison is CI/debug/lab only (O(n) — would violate E1 in production). Production cheap variant: node count + tableHash vs client-reported hash. | Lab: `lab/structuralDiff.ts` + `requestStructuralDiff` (Virtual DOM × client DOM). **Local table×DOM:** `compareTableToLiveDom` / `requestTableLiveOracle` (producer `ReplicatedTable` × Virtual live child order). Not in `FrameInvariantMonitor` (wire-only). Production cheap variant still later. |
| **O3** | **Budget gate** | [budgets.md](budgets.md) in CI. Exceeding P1–P7 or E1–E11 fails the build. | Lab telemetry percentiles exist; not wired as CI O3 |
| **O4** | **Density harness** | N concurrent sessions; per-session P1–P6 + host CPU/memory; find the **knee**. K3 cannot be claimed without it. | Not run (`PP-DEN-1` unrun) |
| **O5** | **Interaction latency probe** | Click / type / scroll: local feedback (P4) and authoritative effect (P5), including with network stalled. | Not in lab tree (input plane not cut over) |

O1, O2 and O5 MUST eventually run against at least `www.belezanaweb.com.br`, an Eneba soft-nav flow, and a live-odds page ([roadmap.md](roadmap.md) M3).

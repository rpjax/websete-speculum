# PageProjection oracles — coverage truth (WP1/WP2)

Style: [SessionsTest MATRIX](../Speculum.Api.SessionsTest.Tests/MATRIX.md).  
Canon: [docs/page-projection-engine-redesign.md](../../docs/page-projection-engine-redesign.md) §7–§8.  
Policy: [docs/assert-failure-policy.md](../../docs/assert-failure-policy.md) — no soft-skip.

| ID | Oracle | Assert | Fixture / live |
|----|--------|--------|----------------|
| O1 | Visual P7 | Dual stills; ≤0.5% pixels **and** 0 structural regions (≥2% viewport or text-only-one-side) | Fixture blank-hero **FAIL** on current; live Beleza/Eneba/odds |
| O2 | Structural | F(V)↔mirror↔client isomorphic (CI full); prod = count+checksum | Fixture drift **FAIL**; live CI full |
| O3 | Budgets | Any P1–P7 / E1–E11 miss = fail | `fixtures/current-engine-sample` **FAIL** E2/E8/E1/E10/D1 |
| O4 | Density | Knee curve; `PP-DEN-2` baseline | Synthetic current-engine curve; knee ≪ 100 |
| O5 | Interaction | P4 ≤16ms (stalled net); P5 ≤RTT+50 | Current-engine fixture **FAIL** P4 (D6) |

**WP1 exit:** oracles that **pass** today's engine evidence are broken. Unit tests above assert FAIL on current fixtures (suite green = oracles correctly reject). Live stack job remains red until engine WP9+.

**Live cutover (C1–C4):** product path is V2 binary (`LivePageProjection` → opaque API relay → `ProjectionClient`). **C5 §9 V1 deletion** stays blocked until live O1/O2/O5 pass on the three sites below — fixture FAIL-on-current is not accept.

**Sites (live):** `www.belezanaweb.com.br`, Eneba soft-nav, live-odds.

**K1:** stills only — no Screencast / VideoStreaming for O1.
